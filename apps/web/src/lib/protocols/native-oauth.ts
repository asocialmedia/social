import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { redis } from "@asm/db";
import { cookies } from "next/headers";
import { z } from "zod";

import {
  accountNotices,
  noticeTimestamp,
  queueNotice,
} from "@/lib/auth/account-notices";
import {
  blueskyOAuthOrigin,
  createBlueskyOAuthClient,
} from "@/lib/protocols/oauth";

export const NATIVE_BLUESKY_COOKIE = "asm-bluesky-native-oauth";
export const NATIVE_BLUESKY_RETURN = "asocialmedia://settings";
export const nativeFlowSchema = z.object({
  challenge: z.string().regex(/^[a-f0-9]{64}$/),
  email: z.string().nullable(),
  handle: z.string(),
  state: z.uuid(),
  userId: z.string(),
});
export const nativeResultSchema = nativeFlowSchema.extend({
  did: z.string(),
  handle: z.string(),
});
export const nativeFlowKey = (nonce: string) =>
  `asm:bluesky:oauth:native:browser:${nonce}`;
export const nativeTicketKey = (ticket: string) =>
  `asm:bluesky:oauth:native:launch:${ticket}`;
export const nativeResultKey = (code: string) =>
  `asm:bluesky:oauth:native:result:${code}`;
export const nativeOAuthToken = () => randomBytes(32).toString("base64url");

export function matchesNativeChallenge(verifier: string, challenge: string) {
  const digest = createHash("sha256").update(verifier).digest("hex");
  return (
    challenge.length === digest.length &&
    timingSafeEqual(Buffer.from(digest), Buffer.from(challenge))
  );
}

export async function nativeBlueskyCallback(
  request: Request
): Promise<Response | null> {
  const jar = await cookies();
  const nonce = jar.get(NATIVE_BLUESKY_COOKIE)?.value;
  if (!nonce) {
    return null;
  }
  jar.delete(NATIVE_BLUESKY_COOKIE);
  const stored = await redis.getdel(nativeFlowKey(nonce));
  if (!stored) {
    return Response.json(
      { error: "Authorization expired. Return to the app and try again." },
      { status: 400 }
    );
  }
  const flow = nativeFlowSchema.parse(JSON.parse(stored));
  const target = new URL(NATIVE_BLUESKY_RETURN);
  target.searchParams.set("tab", "account");
  target.searchParams.set("state", flow.state);
  try {
    const client = createBlueskyOAuthClient(flow.userId, true);
    const result = await client.callback(new URL(request.url).searchParams);
    const state = z
      .object({ native: z.literal(true), nonce: z.uuid(), userId: z.string() })
      .parse(JSON.parse(result.state ?? "null"));
    if (state.nonce !== nonce || state.userId !== flow.userId) {
      throw new Error("Invalid browser state");
    }
    const profileResponse = await result.session.fetchHandler(
      `/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(result.session.did)}`
    );
    if (!profileResponse.ok) {
      throw new Error("Profile unavailable");
    }
    const profile = z
      .object({ handle: z.string().min(1) })
      .parse(await profileResponse.json());
    const code = nativeOAuthToken();
    await redis.set(
      nativeResultKey(code),
      JSON.stringify({
        ...flow,
        did: result.session.did,
        handle: profile.handle,
      }),
      "EX",
      120
    );
    target.searchParams.set("code", code);
    target.searchParams.set("bluesky", "authorized");
  } catch {
    target.searchParams.set("bluesky", "error");
  }
  return new Response(null, {
    headers: {
      "cache-control": "no-store",
      location: target.href,
      "referrer-policy": "no-referrer",
    },
    status: 303,
  });
}

export function notifyNativeBlueskyLink(email: string | null, handle: string) {
  if (email) {
    queueNotice(() =>
      accountNotices.socialAccount({
        accountName: `@${handle}`,
        action: "linked",
        changedAt: noticeTimestamp(),
        provider: "bluesky",
        recipient: email,
      })
    );
  }
}

export function nativeLaunchUrl(ticket: string) {
  const url = new URL(
    "/api/protocols/bluesky/oauth/native",
    blueskyOAuthOrigin()
  );
  url.searchParams.set("ticket", ticket);
  return url.href;
}
