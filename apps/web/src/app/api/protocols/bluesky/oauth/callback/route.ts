import { cookies } from "next/headers";
import { z } from "zod";

import {
  accountNotices,
  noticeTimestamp,
  queueNotice,
} from "@/lib/auth/account-notices";
import { getSessionFromApi } from "@/lib/auth/session";
import { nativeBlueskyCallback } from "@/lib/protocols/native-oauth";
import {
  blueskyOAuthOrigin,
  createBlueskyOAuthClient,
  finishBlueskyOAuth,
} from "@/lib/protocols/oauth";
import { BLUESKY_OAUTH_COOKIE } from "@/lib/protocols/oauth-config";

const stateSchema = z.object({ nonce: z.uuid(), userId: z.string().min(1) });

export async function GET(request: Request) {
  const origin = blueskyOAuthOrigin();
  const incoming = new URL(request.url);
  if (
    new URL(origin).hostname === "localhost" &&
    incoming.hostname === "127.0.0.1"
  ) {
    const canonical = new URL(incoming.pathname + incoming.search, origin);
    return new Response(null, {
      headers: {
        "cache-control": "no-store",
        location: canonical.href,
        "referrer-policy": "no-referrer",
      },
      status: 303,
    });
  }
  const native = await nativeBlueskyCallback(request);
  if (native) {
    return native;
  }
  const target = new URL("/settings?tab=account", origin);
  const session = await getSessionFromApi();
  const cookieJar = await cookies();
  const nonce = cookieJar.get(BLUESKY_OAUTH_COOKIE)?.value;
  cookieJar.delete(BLUESKY_OAUTH_COOKIE);
  try {
    if (!session?.user.emailVerified || !nonce) {
      throw new Error("Missing session");
    }
    const client = createBlueskyOAuthClient(session.user.id, true);
    const result = await client.callback(new URL(request.url).searchParams);
    const state = stateSchema.parse(JSON.parse(result.state ?? "null"));
    if (state.userId !== session.user.id || state.nonce !== nonce) {
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
    await finishBlueskyOAuth(
      session.user.id,
      result.session.did,
      profile.handle
    );
    target.searchParams.set("bluesky", "connected");

    // The link is committed. Notify without awaiting so the redirect is not
    // delayed by the mail hop.
    const recipient = session.user.email;
    if (recipient) {
      queueNotice(() =>
        accountNotices.socialAccount({
          accountName: `@${profile.handle}`,
          action: "linked",
          changedAt: noticeTimestamp(),
          provider: "bluesky",
          recipient,
        })
      );
    }
  } catch {
    target.searchParams.set("bluesky", "error");
  }
  return Response.redirect(target, 303);
}
