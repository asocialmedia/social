import { describe, expect, test } from "bun:test";

import {
  isProfileViewTab,
  parseProfileTab,
  profileTabStorageKey,
} from "./profile-tab-memory";

describe("profile tab memory", () => {
  test("accepts the six native profile tabs", () => {
    for (const value of [
      "posts",
      "gusts",
      "responses",
      "eddies",
      "amplified",
      "media",
    ]) {
      expect(isProfileViewTab(value)).toBe(true);
    }
    expect(isProfileViewTab("replies")).toBe(false);
  });

  test("falls back to posts for invalid persisted values", () => {
    expect(parseProfileTab("media")).toBe("media");
    expect(parseProfileTab("nope")).toBe("posts");
    expect(parseProfileTab(null)).toBe("posts");
  });

  test("keys memory by normalized username", () => {
    expect(profileTabStorageKey("Alice")).toBe("native-profile-tab:alice");
  });
});
