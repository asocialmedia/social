import { describe, expect, test } from "bun:test";

import { supportsNativeMessageKdf } from "./native-kdf-availability";

describe("message KDF platform compatibility", () => {
  test("Android 7 stays on the yielding fallback", () => {
    expect(supportsNativeMessageKdf("android", 24)).toBe(false);
    expect(supportsNativeMessageKdf("android", 25)).toBe(false);
  });

  test("Android 8 and newer can recover on the native background queue", () => {
    expect(supportsNativeMessageKdf("android", 26)).toBe(true);
    expect(supportsNativeMessageKdf("android", 36)).toBe(true);
  });

  test("iOS version strings do not use Android's provider cutoff", () => {
    expect(supportsNativeMessageKdf("ios", "18.5")).toBe(true);
  });
});
