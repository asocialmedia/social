import { redis } from "@asm/db";
import { cookies } from "next/headers";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import { consumeProtocolBudget } from "@/lib/protocols/gateway";
import {
  matchesNativeChallenge,
  NATIVE_BLUESKY_COOKIE,
  nativeFlowKey,
  nativeFlowSchema,
  nativeLaunchUrl,
  nativeOAuthToken,
  nativeResultKey,
  nativeResultSchema,
  nativeTicketKey,
  notifyNativeBlueskyLink,
} from "@/lib/protocols/native-oauth";
import {
  blueskyOAuthOrigin,
  createBlueskyOAuthClient,
  finishBlueskyOAuth,
} from "@/lib/protocols/oauth";
import { isTrustedMutationOrigin } from "@/lib/security/request-origin";

const issueSchema = z
  .object({
    challenge: z.string().regex(/^[a-f0-9]{64}$/),
    handle: z.string().trim().min(1).max(253),
    state: z.uuid(),
  })
  .strict();
const finishSchema = z
  .object({
    code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    verifier: z.string().min(43).max(128),
  })
  .strict();
const headers = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
};

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user.id) {
    return Response.json({ error: "Unauthorized" }, { headers, status: 401 });
  }
  if (!session.user.emailVerified) {
    return Response.json(
      { error: "Verify your ASM email before connecting Bluesky." },
      { headers, status: 403 }
    );
  }
  if (!isTrustedMutationOrigin(request)) {
    return Response.json({ error: "Invalid origin" }, { headers, status: 403 });
  }
  await consumeProtocolBudget(session.user.id, "feedback", true);
  const text = await request.text();
  if (text.length > 2048) {
    return Response.json(
      { error: "Request too large" },
      { headers, status: 413 }
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json(
      { error: "Invalid authorization request" },
      { headers, status: 400 }
    );
  }
  const finish = finishSchema.safeParse(body);
  if (finish.success) {
    const key = nativeResultKey(finish.data.code);
    const stored = await redis.get(key);
    if (!stored) {
      return Response.json(
        { error: "Authorization expired. Try connecting again." },
        { headers, status: 410 }
      );
    }
    const result = nativeResultSchema.parse(JSON.parse(stored));
    if (
      result.userId !== session.user.id ||
      !matchesNativeChallenge(finish.data.verifier, result.challenge)
    ) {
      return Response.json(
        { error: "Authorization does not belong to this app session." },
        { headers, status: 403 }
      );
    }
    if (!(await redis.getdel(key))) {
      return Response.json(
        { error: "Authorization already completed." },
        { headers, status: 409 }
      );
    }
    await finishBlueskyOAuth(session.user.id, result.did, result.handle);
    notifyNativeBlueskyLink(result.email, result.handle);
    return Response.json(
      { connected: true, handle: result.handle },
      { headers }
    );
  }
  const issue = issueSchema.safeParse(body);
  if (!issue.success) {
    return Response.json(
      { error: "Enter a valid Bluesky handle." },
      { headers, status: 400 }
    );
  }
  const ticket = nativeOAuthToken();
  await redis.set(
    nativeTicketKey(ticket),
    JSON.stringify({
      ...issue.data,
      email: session.user.email ?? null,
      userId: session.user.id,
    }),
    "EX",
    120
  );
  return Response.json({ url: nativeLaunchUrl(ticket) }, { headers });
}

export async function GET(request: Request) {
  const ticket = new URL(request.url).searchParams.get("ticket");
  if (!ticket || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) {
    return Response.json(
      { error: "Invalid authorization link" },
      { headers, status: 400 }
    );
  }
  const stored = await redis.getdel(nativeTicketKey(ticket));
  if (!stored) {
    return Response.json(
      { error: "Authorization link expired. Return to the app and try again." },
      { headers, status: 410 }
    );
  }
  const flow = nativeFlowSchema.parse(JSON.parse(stored));
  const nonce = crypto.randomUUID();
  try {
    const authorization = await createBlueskyOAuthClient(
      flow.userId,
      true
    ).authorize(flow.handle.replace(/^@/, "").toLowerCase(), {
      signal: AbortSignal.timeout(15_000),
      state: JSON.stringify({ native: true, nonce, userId: flow.userId }),
    });
    await redis.set(nativeFlowKey(nonce), JSON.stringify(flow), "EX", 600);
    const jar = await cookies();
    jar.set(NATIVE_BLUESKY_COOKIE, nonce, {
      httpOnly: true,
      maxAge: 600,
      path: "/",
      sameSite: "lax",
      secure: new URL(blueskyOAuthOrigin()).protocol === "https:",
    });
    return new Response(null, {
      headers: { ...headers, location: authorization.href },
      status: 303,
    });
  } catch {
    return Response.json(
      {
        error:
          "Could not start authorization. Return to the app and check your handle.",
      },
      { headers, status: 400 }
    );
  }
}
