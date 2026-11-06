import { describe, expect, test } from "bun:test";

import type { NativeStackNavigationOptions } from "expo-router";

import { finishPostEnter, postEnterAnimation } from "./navigation-motion";

describe("post navigation motion", () => {
  test("restored routes do not animate beneath the launch splash", () => {
    expect(postEnterAnimation(false)).toBe("none");
    expect(postEnterAnimation(true)).toBe("fade");
  });

  test("a completed forward fade arms native slide back before dismissal", () => {
    const changes: Pick<NativeStackNavigationOptions, "animation">[] = [];
    finishPostEnter(
      (options) => changes.push(options),
      false,
      "android",
      false
    );
    expect(changes).toEqual([{ animation: "slide_from_right" }]);
    finishPostEnter((options) => changes.push(options), true, "android", false);
    expect(changes).toHaveLength(1);
  });

  test("return gestures retain the iOS native transition and respect reduced motion", () => {
    const changes: Pick<NativeStackNavigationOptions, "animation">[] = [];
    finishPostEnter((options) => changes.push(options), false, "ios", false);
    finishPostEnter((options) => changes.push(options), false, "android", true);
    expect(changes).toEqual([{ animation: "default" }, { animation: "fade" }]);
  });
});
