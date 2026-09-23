import { describe, expect, test } from "bun:test";

import {
  filterCues,
  formatCueTime,
  isCueActive,
  transcriptCopyText,
} from "./transcript-view";

const cues = [
  { end: 0.4, start: 0, text: "Hello there" },
  { end: 6, start: 2, text: "General Kenobi" },
];

describe("transcript view", () => {
  test("short cues stay live for at least 1.5s", () => {
    const [short] = cues;
    if (!short) {
      throw new Error("fixture missing");
    }
    expect(isCueActive(short, 1.2)).toBe(true);
    expect(isCueActive(short, 1.6)).toBe(false);
  });

  test("long cues end at their own end", () => {
    const long = cues.at(1);
    if (!long) {
      throw new Error("fixture missing");
    }
    expect(isCueActive(long, 5.9)).toBe(true);
    expect(isCueActive(long, 6.1)).toBe(false);
    expect(isCueActive(long, 1.9)).toBe(false);
  });

  test("search is case-insensitive and blank shows all", () => {
    expect(filterCues(cues, "  kenobi ").map((cue) => cue.text)).toEqual([
      "General Kenobi",
    ]);
    expect(filterCues(cues, "")).toHaveLength(2);
  });

  test("timestamps read m:ss", () => {
    expect(formatCueTime(0)).toBe("0:00");
    expect(formatCueTime(65.9)).toBe("1:05");
    expect(formatCueTime(Number.NaN)).toBe("0:00");
  });

  test("copy prefers cue text and falls back to the raw transcript", () => {
    expect(transcriptCopyText(cues, "raw")).toBe("Hello there General Kenobi");
    expect(transcriptCopyText([], "  raw text ")).toBe("raw text");
    expect(transcriptCopyText([], null)).toBe("");
  });
});
