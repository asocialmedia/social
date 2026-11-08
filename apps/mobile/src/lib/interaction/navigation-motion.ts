import type { NativeStackNavigationOptions } from "expo-router";

type Animation = NonNullable<NativeStackNavigationOptions["animation"]>;

// Use one native transition for arrival and return; changing options from
// transitionEnd can target a navigator that has already been detached.
export function postEnterAnimation(
  presented: boolean,
  platform = "android",
  reducedMotion = false
): Animation {
  if (!presented) {
    return "none";
  }
  if (reducedMotion) {
    return "fade";
  }
  return platform === "ios" ? "default" : "slide_from_right";
}
