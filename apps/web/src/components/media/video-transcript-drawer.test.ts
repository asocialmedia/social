import { describe, expect, test } from "bun:test";

import { parseWebVttCues } from "./video-transcript-drawer";

describe("parseWebVttCues", () => {
  test("parses standard WebVTT subtitle cues correctly", () => {
    const vtt = `WEBVTT - AsocialMedia Video Captions

1
00:00:01.500 --> 00:00:04.200
Welcome to AsocialMedia video player.

2
00:00:05.000 --> 00:00:08.500
Here is how speech to text transcription works.
`;

    const cues = parseWebVttCues(vtt);
    expect(cues.length).toBe(2);
    expect(cues[0]?.start).toBeCloseTo(1.5, 2);
    expect(cues[0]?.end).toBeCloseTo(4.2, 2);
    expect(cues[0]?.text).toBe("Welcome to AsocialMedia video player.");

    expect(cues[1]?.start).toBeCloseTo(5, 2);
    expect(cues[1]?.end).toBeCloseTo(8.5, 2);
    expect(cues[1]?.text).toBe(
      "Here is how speech to text transcription works."
    );
  });

  test("handles hour-level timestamps correctly", () => {
    const vtt = `WEBVTT

1
01:15:30.250 --> 01:15:35.750
Long stream chapter cue.
`;

    const cues = parseWebVttCues(vtt);
    expect(cues.length).toBe(1);
    // 1h 15m 30.25s = 3600 + 900 + 30.25 = 4530.25s
    expect(cues[0]?.start).toBeCloseTo(4530.25, 2);
    expect(cues[0]?.end).toBeCloseTo(4535.75, 2);
    expect(cues[0]?.text).toBe("Long stream chapter cue.");
  });

  test("handles empty or malformed inputs without crashing", () => {
    expect(parseWebVttCues("")).toEqual([]);
    expect(parseWebVttCues("WEBVTT\n\n")).toEqual([]);
    expect(parseWebVttCues("random junk text line")).toEqual([]);
  });
});
