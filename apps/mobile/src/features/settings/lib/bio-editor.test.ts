import { describe, expect, test } from "bun:test";

import {
  BIO_CHAR_LIMIT,
  BIO_WORD_LIMIT,
  countBioWords,
  isBioWithinWordLimit,
} from "./bio-editor";

describe("bio editor limits", () => {
  test("matches the shared profile schema limits", () => {
    expect(BIO_WORD_LIMIT).toBe(400);
    expect(BIO_CHAR_LIMIT).toBe(2000);
  });

  test("counts words like the schema's whitespace split", () => {
    expect(countBioWords("")).toBe(0);
    expect(countBioWords("   ")).toBe(0);
    expect(countBioWords("hello world")).toBe(2);
    expect(countBioWords("  hello\n\tworld  again ")).toBe(3);
    expect(countBioWords("@alice #tag https://example.com")).toBe(3);
  });

  test("gates save at exactly 400 words", () => {
    const atLimit = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
    expect(countBioWords(atLimit)).toBe(400);
    expect(isBioWithinWordLimit(atLimit)).toBe(true);
    expect(isBioWithinWordLimit(`${atLimit} one-more`)).toBe(false);
  });
});
