// Perceptual hash + audio fingerprint helpers. The pipeline stores hashes
// on Media.phash:
//   image/video — 64-bit dHash-style hex (16 hex chars) from a poster/thumb
//                 frame via ffmpeg gray pixels
//   audio       — 128-bit chroma-fingerprint hex (32 hex chars) from spectral
//                 centroids + chroma vectors sampled across the track
// These helpers turn stored hashes into reupload-detection signals.
//
// Hamming distance between perceptual hashes is a SIMILARITY SIGNAL, never
// proof of ownership: two different photos or remastered tracks of the same
// source can land close, and heavy crops/remixes can escape detection
// entirely. Decisions about stolen or reposted content always need a human or
// an embedding-level check.

const HEX_CHAR_RE = /^[0-9a-f]$/;

// Audio tracks produce 32-hex-char fingerprints (128 bits); image/video use
// 16 hex chars (64 bits). Comparison is length-checked, so cross-type
// distances safely return null (treated as non-match).
export const AUDIO_FPRINT_LENGTH = 32;

// How many hex chars of an audio fingerprint may differ and still count as
// a near-duplicate. 12 hex chars == 48 bits, calibrated to survive loudnorm
// + Opus/AAC transcode + waveform re-encode.
export const AUDIO_FPRINT_MATCH_DISTANCE = 12;

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
  // Use the stricter image threshold for 64-bit hashes and the wider audio
  // threshold for 128-bit fingerprints.
  const threshold =
    a.length === AUDIO_FPRINT_LENGTH ? AUDIO_FPRINT_MATCH_DISTANCE * 4 : PHASH_MATCH_DISTANCE;
  return distance <= threshold;
}

export function isLikelyDuplicateAudioHash(a: string, b: string): boolean {
  const distance = hammingDistanceHex(a, b);
  if (distance === null) {
    return false;
  }
  return distance <= AUDIO_FPRINT_MATCH_DISTANCE * 4;
}
