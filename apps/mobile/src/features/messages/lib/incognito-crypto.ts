import { hkdfSha256 } from "./crypto-primitives";

export function deriveNativeIncognitoRootKey(
  rootKey: Uint8Array,
  sessionId: string
): Uint8Array {
  const encoder = new TextEncoder();
  return hkdfSha256(
    rootKey,
    encoder.encode(sessionId),
    encoder.encode("asocialmedia:incognito:v1"),
    32
  );
}
