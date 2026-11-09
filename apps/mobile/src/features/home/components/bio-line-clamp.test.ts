import { describe, expect, test } from "bun:test";

import {
  clampBioSegmentsByLines,
  estimateCharsPerLine,
  segmentBioContent,
} from "./profile-utils";

function visibleText(result: ReturnType<typeof clampBioSegmentsByLines>) {
  return result.visible
    .map((segment) =>
      segment.type === "text" ? segment.text : `[${segment.type}]`
    )
    .join("");
}

describe("clampBioSegmentsByLines", () => {
  test("short bodies are left alone", () => {
    const result = clampBioSegmentsByLines(
      segmentBioContent("hello world"),
      6,
      40
    );
    expect(result.clamped).toBe(false);
    expect(visibleText(result)).toBe("hello world");
  });

  test("ten short lines collapse to six, which a character budget missed", () => {
    const body = Array.from({ length: 10 }, (_, index) => `line ${index}`).join(
      "\n"
    );
    const result = clampBioSegmentsByLines(segmentBioContent(body), 6, 40);
    expect(result.clamped).toBe(true);
    expect(visibleText(result).split("\n")).toEqual([
      "line 0",
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
    ]);
  });

  test("a long paragraph is cut on a word boundary after six wrapped lines", () => {
    const body = Array.from({ length: 200 }, () => "word").join(" ");
    const result = clampBioSegmentsByLines(segmentBioContent(body), 6, 20);
    const text = visibleText(result);
    expect(result.clamped).toBe(true);
    // Four "word " runs fit a 20-char line, so six lines hold 24 words.
    expect(text.split(" ")).toHaveLength(24);
    expect(text.endsWith("word")).toBe(true);
  });

  test("pills are never split and count toward the line budget", () => {
    const body = "start #one #two #three #four #five #six #seven #eight";
    const result = clampBioSegmentsByLines(segmentBioContent(body), 2, 12);
    expect(result.clamped).toBe(true);
    for (const segment of result.visible) {
      if (segment.type === "tag") {
        expect(body).toContain(`#${segment.tag}`);
      }
    }
  });

  test("one unbreakable run is cut by characters rather than hidden", () => {
    const token = "x".repeat(500);
    const result = clampBioSegmentsByLines(segmentBioContent(token), 6, 40);
    expect(result.clamped).toBe(true);
    expect(visibleText(result)).toHaveLength(240);
  });

  test("blank-line paragraphs still count as lines", () => {
    const result = clampBioSegmentsByLines(
      segmentBioContent("a\nb\nc\nd\ne\nf\ng"),
      6,
      40
    );
    expect(visibleText(result)).toBe("a\nb\nc\nd\ne\nf");
  });
});

describe("estimateCharsPerLine", () => {
  test("scales with width and font size", () => {
    expect(estimateCharsPerLine(300, 14)).toBe(41);
    expect(estimateCharsPerLine(600, 14)).toBeGreaterThan(
      estimateCharsPerLine(300, 14)
    );
  });

  test("degenerate inputs never return zero", () => {
    expect(estimateCharsPerLine(0, 14)).toBe(1);
    expect(estimateCharsPerLine(Number.NaN, 14)).toBe(1);
  });
});
