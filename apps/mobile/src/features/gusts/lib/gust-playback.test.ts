import { describe, expect, test } from "bun:test";

import type { GustPlaybackInputs } from "./gust-playback";
import { resolveGustPlayback } from "./gust-playback";

function inputs(overrides: Partial<GustPlaybackInputs>): GustPlaybackInputs {
  return {
    appActive: true,
    hasSource: true,
    isActive: true,
    revealed: true,
    suspended: false,
    userPaused: false,
    wasPlaying: false,
    ...overrides,
  };
}

describe("resolveGustPlayback", () => {
  test("plays when active, foreground and revealed", () => {
    expect(resolveGustPlayback(inputs({}))).toEqual({
      action: "play",
      nextUserPaused: false,
      nextWasPlaying: false,
      rewind: false,
    });
  });

  test("holds without a source", () => {
    expect(resolveGustPlayback(inputs({ hasSource: false }))).toMatchObject({
      action: "hold",
      rewind: false,
    });
  });

  test("leaving the window pauses, rewinds and clears a tap pause", () => {
    expect(
      resolveGustPlayback(inputs({ isActive: false, userPaused: true }))
    ).toEqual({
      action: "pause",
      nextUserPaused: false,
      nextWasPlaying: false,
      rewind: true,
    });
  });

  test("backgrounding holds without rewinding", () => {
    expect(resolveGustPlayback(inputs({ appActive: false }))).toEqual({
      action: "pause",
      nextUserPaused: false,
      nextWasPlaying: true,
      rewind: false,
    });
  });

  test("a tap pause survives backgrounding and stays paused", () => {
    const held = resolveGustPlayback(
      inputs({ appActive: false, userPaused: true })
    );
    expect(held.nextWasPlaying).toBe(true);
    expect(
      resolveGustPlayback(
        inputs({ userPaused: held.nextUserPaused, wasPlaying: true })
      ).action
    ).toBe("play");
    expect(
      resolveGustPlayback(inputs({ userPaused: true, wasPlaying: false }))
        .action
    ).toBe("hold");
  });

  test("an unrevealed (explicit-gated) card never plays", () => {
    expect(resolveGustPlayback(inputs({ revealed: false })).action).toBe(
      "hold"
    );
  });

  test("suspension matches backgrounding", () => {
    expect(resolveGustPlayback(inputs({ suspended: true }))).toEqual(
      resolveGustPlayback(inputs({ appActive: false }))
    );
  });
});
