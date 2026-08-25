// Perceptual hash comparison. The pipeline stores 64-bit dHash-style hex
// strings (16 hex chars) on Media.phash - images via a poster/thumb frame,
// videos via the scene-aware poster frame. These helpers turn those stored
// hashes into reupload-detection signals.
//
// Hamming distance between perceptual hashes is a SIMILARITY SIGNAL, never
// proof of ownership: two different photos of the same scene can land close,
// and heavy crops can escape detection entirely. Decisions about stolen or
// reposted content always need a human or an embedding-level check.

const HEX_CHAR_RE = /^[0-9a-f]$/;

function popcount8(byte: number): number {
  let count = 0;
  let value = byte;
  while (value) {
    value &= value - 1;
    count += 1;
  }
  return count;
}

// Bit distance between two equal-length hex hashes (case-insensitive).
// Returns null when either input is not hex or lengths differ - callers
// treat null as "incomparable", not as a match or a mismatch.
export function hammingDistanceHex(a: string, b: string): number | null {
  if (a.length === 0 || a.length !== b.length) {
    return null;
  }
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftChar = left[index];
    const rightChar = right[index];
    if (
      !leftChar ||
      !rightChar ||
      !HEX_CHAR_RE.test(leftChar) ||
      !HEX_CHAR_RE.test(rightChar)
    ) {
      return null;
    }
    distance += popcount8(
      Number.parseInt(leftChar, 16) ^ Number.parseInt(rightChar, 16)
    );
  }
  return distance;
}

// 64-bit dHash values: pairs within this distance are near-duplicates with
// high probability (identical re-encodes land at 0-2, resizes/compressions
// drift a handful of bits). Tunable per product surface; start strict.
export const PHASH_MATCH_DISTANCE = 10;

export function isLikelyDuplicateHash(a: string, b: string): boolean {
  const distance = hammingDistanceHex(a, b);
  if (distance === null) {
    return false;
  }
  return distance <= PHASH_MATCH_DISTANCE;
}
