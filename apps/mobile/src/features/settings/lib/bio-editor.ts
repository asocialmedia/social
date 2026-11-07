// Pure bio helpers for the settings profile tab. The limits mirror the
// shared `updateUserProfileSchema` (400 words, 2000 characters) and web's
// `AnimatedWordCounter max={400}` so the tab gates Save on exactly what the
// server will accept.
export const BIO_WORD_LIMIT = 400;

export const BIO_CHAR_LIMIT = 2000;

export function countBioWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function isBioWithinWordLimit(text: string): boolean {
  return countBioWords(text) <= BIO_WORD_LIMIT;
}
