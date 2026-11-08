// QR code PNG download helpers. Pure base64 decoding lives here so it is
// unit-testable on Node; the expo-file-system / expo-media-library IO stays
// in the share sheet component. No React Native imports in this file.
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function decodeBase64ToBytes(base64: string): Uint8Array {
  let padded = base64.replaceAll(/\s/g, "");
  while (padded.endsWith("=")) {
    padded = padded.slice(0, -1);
  }
  if (padded.length % 4 === 1) {
    throw new Error("Invalid base64 input");
  }
  // Arithmetic, not shifts: the repo bans bitwise operators, and the
  // multiply/divide form is exactly what a shift/mask version computes.
  const out: number[] = [];
  for (let index = 0; index < padded.length; index += 4) {
    const chunk = padded.slice(index, index + 4);
    const vals = [...chunk].map((char) => {
      const value = BASE64_ALPHABET.indexOf(char);
      if (value === -1) {
        throw new Error("Invalid base64 input");
      }
      return value;
    });
    const triple =
      (vals[0] ?? 0) * 262_144 +
      (vals[1] ?? 0) * 4096 +
      (vals[2] ?? 0) * 64 +
      (vals[3] ?? 0);
    out.push(Math.floor(triple / 65_536) % 256);
    if (chunk.length > 2) {
      out.push(Math.floor(triple / 256) % 256);
    }
    if (chunk.length > 3) {
      out.push(triple % 256);
    }
  }
  return new Uint8Array(out);
}
