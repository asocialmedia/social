// Trusted-ingress policy for the auth service.
//
// Cloudflare sets cf-connecting-ip for every request it forwards, overwriting
// anything a client supplied, so it is the primary source. x-forwarded-for is
// only honored for its LAST entry: that is the address appended by the nearest
// trusted proxy (the web app's internal caller or Cloudflare), while earlier
// entries are client-controlled and can be rotated to evade per-IP limits.
export function getClientIpFromHeaders(headers: Headers | undefined): string {
  const cf = headers?.get?.("cf-connecting-ip");
  if (cf && cf.trim()) {
    return cf.trim();
  }
  const forwarded = headers?.get?.("x-forwarded-for");
  if (forwarded) {
    const entries = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const last = entries.at(-1);
    if (last) {
      return last;
    }
  }
  const realIp = headers?.get?.("x-real-ip");
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }
  return "unknown";
}
