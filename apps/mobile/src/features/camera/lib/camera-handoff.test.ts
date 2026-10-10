import { describe, expect, test } from "bun:test";

import {
  composerModeForTarget,
  pickedFromCapture,
  targetAllowsKind,
} from "./camera-handoff";

describe("composerModeForTarget", () => {
  test("gusts compose as gusts, fleet and community compose as fleets", () => {
    expect(composerModeForTarget("gust")).toBe("gust");
    expect(composerModeForTarget("fleet")).toBe("post");
    expect(composerModeForTarget("community")).toBe("post");
  });
});

describe("targetAllowsKind", () => {
  test("gusts require video, fleets and community accept either", () => {
    expect(targetAllowsKind("gust", "video")).toBe(true);
    expect(targetAllowsKind("gust", "photo")).toBe(false);
    expect(targetAllowsKind("fleet", "photo")).toBe(true);
    expect(targetAllowsKind("community", "video")).toBe(true);
  });
});

describe("pickedFromCapture", () => {
  test("photos map to jpeg and videos to mp4 with usable names", () => {
    const photo = pickedFromCapture("file:///cache/photo.jpg", "photo");
    expect(photo.mimeType).toBe("image/jpeg");
    expect(photo.uri).toBe("file:///cache/photo.jpg");
    const video = pickedFromCapture("file:///cache/clip", "video");
    expect(video.mimeType).toBe("video/mp4");
    expect(video.name.endsWith(".mp4")).toBe(true);
  });
});
