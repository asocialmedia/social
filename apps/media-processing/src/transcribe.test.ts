import { describe, expect, test } from "bun:test";

import { formatVttTimestamp, generateWebVtt } from "./transcribe";
import type { CaptionSegment } from "./transcribe";

describe("formatVttTimestamp", () => {
  test("formats 0 seconds correctly", () => {
    expect(formatVttTimestamp(0)).toBe("00:00:00.000");
  });

  test("formats standard minutes and seconds", () => {
    expect(formatVttTimestamp(65.421)).toBe("00:01:05.421");
  });

  test("formats hours correctly", () => {
    expect(formatVttTimestamp(3661.05)).toBe("01:01:01.050");
  });

  test("handles negative input safely", () => {
    expect(formatVttTimestamp(-5)).toBe("00:00:00.000");
  });
});

describe("generateWebVtt", () => {
  test("generates valid WebVTT string from segments", () => {
    const segments: CaptionSegment[] = [
      { end: 2.5, start: 0.5, text: "Welcome to AsocialMedia." },
      { end: 6, start: 3, text: "Here is how to setup your homelab." },
    ];

    const vtt = generateWebVtt(segments);

    expect(vtt).toStartWith("WEBVTT - AsocialMedia Video Captions\n\n");
    expect(vtt).toContain(
      "1\n00:00:00.500 --> 00:00:02.500\nWelcome to AsocialMedia."
    );
    expect(vtt).toContain(
      "2\n00:00:03.000 --> 00:00:06.000\nHere is how to setup your homelab."
    );
  });

  test("filters out empty cues gracefully", () => {
    const segments: CaptionSegment[] = [
      { end: 1, start: 0, text: "" },
      { end: 3, start: 1.5, text: "Valid speech line" },
      { end: 4, start: 3.5, text: "   " },
    ];

    const vtt = generateWebVtt(segments);
    expect(vtt).toContain(
      "1\n00:00:01.500 --> 00:00:03.000\nValid speech line"
    );
    expect(vtt).not.toContain("2\n");
  });
});
