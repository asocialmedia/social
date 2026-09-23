import { describe, expect, test } from "bun:test";

import {
  cuesFromTranscript,
  findActiveCue,
  parseWebVttCues,
  splitCueIntoLines,
  splitTranscriptIntoTimedLines,
} from "./transcript-cues";

describe("parseWebVttCues", () => {
  test("reads cue timings and text, skipping the header and cue indexes", () => {
    const vtt = [
      "WEBVTT",
      "",
      "1",
      "00:00:01.000 --> 00:00:02.500",
      "Hello there",
      "",
      "2",
      "00:03.000 --> 00:04.000",
      "General Kenobi",
    ].join("\n");
    expect(parseWebVttCues(vtt)).toEqual([
      { end: 2.5, start: 1, text: "Hello there" },
      { end: 4, start: 3, text: "General Kenobi" },
    ]);
  });

  test("joins multi-line cue text", () => {
    const vtt = "WEBVTT\n\n00:00.000 --> 00:02.000\nfirst\nsecond\n";
    expect(parseWebVttCues(vtt)).toEqual([
      { end: 2, start: 0, text: "first second" },
    ]);
  });

  test("returns no cues for a header-only track", () => {
    expect(parseWebVttCues("WEBVTT\n\n")).toEqual([]);
  });
});

describe("splitCueIntoLines", () => {
  test("keeps a short cue whole", () => {
    const cue = { end: 2, start: 0, text: "short line" };
    expect(splitCueIntoLines(cue)).toEqual([cue]);
  });

  test("splits sentences and shares the span by word count", () => {
    const lines = splitCueIntoLines({
      end: 4,
      start: 0,
      text: "One two three. Four five six.",
    });
    expect(lines.map((line) => line.text)).toEqual([
      "One two three.",
      "Four five six.",
    ]);
    expect(lines[0]).toMatchObject({ end: 2, start: 0 });
    expect(lines[1]).toMatchObject({ end: 4, start: 2 });
  });
});

describe("splitTranscriptIntoTimedLines", () => {
  test("spreads lines across the clip and ends exactly at its duration", () => {
    const cues = splitTranscriptIntoTimedLines("Hi there. How are you?", 10);
    expect(cues.map((cue) => cue.text)).toEqual(["Hi there.", "How are you?"]);
    expect(cues[0]?.start).toBe(0);
    expect(cues.at(-1)?.end).toBe(10);
  });

  test("chunks long sentences by the word cap", () => {
    const cues = splitTranscriptIntoTimedLines("a b c d e f g h i", 9, 4);
    expect(cues.map((cue) => cue.text)).toEqual(["a b c d", "e f g h", "i"]);
  });

  test("estimates a duration when the clip length is unknown", () => {
    const cues = splitTranscriptIntoTimedLines("just four words here");
    expect(cues.at(-1)?.end).toBe(3);
  });

  test("returns nothing for blank text", () => {
    expect(splitTranscriptIntoTimedLines("   ")).toEqual([]);
  });
});

describe("cuesFromTranscript", () => {
  test("parses a stored transcript that is already WebVTT", () => {
    const cues = cuesFromTranscript("00:00.000 --> 00:01.000\nhey");
    expect(cues).toEqual([{ end: 1, start: 0, text: "hey" }]);
  });

  test("spreads a plain transcript", () => {
    expect(cuesFromTranscript("plain words", 4)).toEqual([
      { end: 4, start: 0, text: "plain words" },
    ]);
  });

  test("returns nothing without a transcript", () => {
    expect(cuesFromTranscript(null)).toEqual([]);
  });
});

describe("findActiveCue", () => {
  const cues = [
    { end: 2, start: 0, text: "a" },
    { end: 5, start: 3, text: "b" },
  ];

  test("finds the cue covering the playhead", () => {
    expect(findActiveCue(cues, 4)?.text).toBe("b");
  });

  test("returns null between cues", () => {
    expect(findActiveCue(cues, 2.5)).toBeNull();
  });
});
