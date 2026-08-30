// Trusted-ingress policy for the auth service.
//
// In production Cloudflare is the only ingress and always sets
// cf-connecting-ip, overwriting anything the client sent, so it is the
// single trusted source. x-forwarded-for / x-real-ip are never consulted in
// production because a direct client fully controls them and could rotate
// IPs to evade per-IP limits (OTP brute force). They are only honored
// outside production (local dev, tests) where no trusted ingress exists.
// x-forwarded-for honors only its LAST entry when honored: that is the
// address appended by the nearest trusted proxy, while earlier entries are
// client-controlled.
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
