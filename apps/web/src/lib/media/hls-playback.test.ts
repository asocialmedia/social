import { expect, test } from "bun:test";

import { hlsPlaybackMode } from "./hls-playback";

test("browsers advertising native HLS still use the supported MSE player", () => {
  expect(hlsPlaybackMode(true, true)).toBe("hls.js");
  expect(hlsPlaybackMode(true, false)).toBe("hls.js");
});

test("native HLS remains available on devices without MSE support", () => {
  expect(hlsPlaybackMode(false, true)).toBe("native");
  expect(hlsPlaybackMode(false, false)).toBe("unsupported");
});
