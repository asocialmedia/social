import { beforeEach, describe, expect, test } from "bun:test";

import { useVideoMuteStore } from "./video-mute-store";

describe("useVideoMuteStore", () => {
  beforeEach(() => {
    useVideoMuteStore.setState({ isMuted: true });
  });

  test("defaults to muted", () => {
    expect(useVideoMuteStore.getState().isMuted).toBe(true);
  });

  test("setMuted updates the shared preference", () => {
    useVideoMuteStore.getState().setMuted(false);
    expect(useVideoMuteStore.getState().isMuted).toBe(false);
  });

  test("toggleMuted flips the preference both ways", () => {
    useVideoMuteStore.getState().setMuted(false);
    useVideoMuteStore.getState().toggleMuted();
    expect(useVideoMuteStore.getState().isMuted).toBe(true);
    useVideoMuteStore.getState().toggleMuted();
    expect(useVideoMuteStore.getState().isMuted).toBe(false);
  });
});
