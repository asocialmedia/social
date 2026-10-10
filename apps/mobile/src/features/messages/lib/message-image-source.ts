// Private message media uses authenticated, account-scoped memory caching.
// Peer-controlled external URLs must never receive the session credentials.
import { withAuthHeaders } from "@/lib/auth-headers";

export function messageImageSource(
  uri: string,
  apiBase: string,
  userId: string | null,
  cookie: string | null
) {
  let target: URL;
  try {
    target = new URL(uri, `${apiBase}/`);
  } catch {
    return { privateMedia: false, source: null };
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return { privateMedia: false, source: null };
  }
  const privateMedia =
    target.origin === new URL(apiBase).origin &&
    target.pathname.startsWith("/api/media/");
  if (!privateMedia) {
    return { privateMedia, source: { uri: target.href } };
  }
  if (!userId || !cookie) {
    return { privateMedia, source: null };
  }
  return {
    privateMedia,
    source: {
      cacheKey: `asm-message:${userId}:${target.href}`,
      headers: withAuthHeaders({}, cookie),
      uri: target.href,
    },
  };
}
