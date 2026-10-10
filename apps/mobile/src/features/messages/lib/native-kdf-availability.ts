// Android's PBKDF2WithHmacSHA256 provider starts at API 26. The app also
// supports API 24/25, where the cooperative wire-compatible fallback is needed.
export function supportsNativeMessageKdf(
  platform: string,
  version: number | string
): boolean {
  return platform !== "android" || Number(version) >= 26;
}
