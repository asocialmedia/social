import { describe, expect, test } from "bun:test";

import { postEnterAnimation } from "./navigation-motion";

describe("stable post navigation transitions", () => {
  test("cold restored routes stay still", () => {
    expect(postEnterAnimation(false)).toBe("none");
  });
  test("arrival and back share a stable native transition", () => {
    expect(postEnterAnimation(true, "android")).toBe("slide_from_right");
    expect(postEnterAnimation(true, "ios")).toBe("default");
  });
  test("reduced motion uses a fade in both directions", () => {
    expect(postEnterAnimation(true, "android", true)).toBe("fade");
  });
});
