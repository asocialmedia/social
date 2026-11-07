import { describe, expect, test } from "bun:test";

import { mediaLockReason } from "./media-lock-reasons";
import type { MediaLockState } from "./media-lock-reasons";

const OPEN: MediaLockState = {
  attachmentCount: 0,
  capacityFull: false,
  hasAudio: false,
  hasGif: false,
  hasVideo: false,
  isGust: false,
};

describe("composer media lock reasons", () => {
  test("unlocked buttons report no reason", () => {
    expect(mediaLockReason("photos", OPEN)).toBeNull();
    expect(mediaLockReason("gif", OPEN)).toBeNull();
    expect(mediaLockReason("audio", OPEN)).toBeNull();
  });

  test("photos lock on audio/gif/capacity with web copy", () => {
    expect(mediaLockReason("photos", { ...OPEN, hasAudio: true })).toBe(
      "Audio is attached - remove it to add other media"
    );
    expect(mediaLockReason("photos", { ...OPEN, hasGif: true })).toBe(
      "A GIF is attached - remove it to add other media"
    );
    expect(
      mediaLockReason("photos", { ...OPEN, capacityFull: true })
    ).toContain("attachments.");
  });

  test("gust-with-video stays hard-disabled with no reason", () => {
    expect(
      mediaLockReason("photos", {
        ...OPEN,
        attachmentCount: 1,
        hasVideo: true,
        isGust: true,
      })
    ).toBeNull();
  });

  test("gif/audio split the web lock copy by what is attached", () => {
    const one = { ...OPEN, attachmentCount: 1 };
    expect(mediaLockReason("gif", { ...one, hasAudio: true })).toContain(
      "add GIFs"
    );
    expect(mediaLockReason("gif", { ...one, hasGif: true })).toBe(
      "A GIF is already attached"
    );
    expect(mediaLockReason("gif", one)).toBe(
      "Remove the current media to add GIFs"
    );
    expect(mediaLockReason("audio", { ...one, hasAudio: true })).toBe(
      "Audio is already attached"
    );
    expect(mediaLockReason("audio", { ...one, hasGif: true })).toContain(
      "add audio"
    );
    expect(mediaLockReason("audio", one)).toBe(
      "Remove the current media to add audio"
    );
  });
});
