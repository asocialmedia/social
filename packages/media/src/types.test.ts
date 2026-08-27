import { describe, expect, test } from "bun:test";

import {
  isAudioTechMetadata,
  isVideoTechMetadata,
  MEDIA_PIPELINE_VERSION,
} from "./types";
import type { AudioTechMetadata } from "./types";

describe("tech metadata guards", () => {
  test("video guard accepts valid payloads and rejects junk", () => {
    const valid = {
      container: "mp4",
      durationSec: 12.5,
      startPts: 0,
      video: {
        bitrateKbps: 2500,
        codec: "h264",
        fps: 30,
        frameRateMode: "CFR",
        height: 720,
        isHdr: false,
        pixelFormat: "yuv420p",
        rotation: 0,
        width: 1280,
      },
    };
    expect(isVideoTechMetadata(valid)).toBe(true);
    expect(isVideoTechMetadata(null)).toBe(false);
    expect(isVideoTechMetadata({ durationSec: 1 })).toBe(false);
  });

  test("audio guard accepts valid payloads and rejects junk", () => {
    const valid: AudioTechMetadata = {
      audio: {
        bitrateKbps: 128,
        channels: 2,
        codec: "aac",
        sampleRateHz: 44_100,
      },
      bytes: 1024,
      container: "mp4",
      durationSec: 180,
      hasCoverArt: false,
    };
    expect(isAudioTechMetadata(valid)).toBe(true);
    expect(isAudioTechMetadata("nope")).toBe(false);
    expect(isAudioTechMetadata({ durationSec: 5 })).toBe(false);
  });

  test("pipeline version is pinned so reprocessing decisions stay stable", () => {
    expect(MEDIA_PIPELINE_VERSION).toBe("3");
  });
});
