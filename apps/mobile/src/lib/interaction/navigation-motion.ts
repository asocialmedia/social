import type { NativeStackNavigationOptions } from "expo-router";

type Animation = NonNullable<NativeStackNavigationOptions["animation"]>;
type AnimationOptions = Pick<NativeStackNavigationOptions, "animation">;

export function postEnterAnimation(presented: boolean): Animation {
  return presented ? "fade" : "none";
}

// Arm the native return transition after arrival, before either back action.
// Updating on beforeRemove is too late for an Android native back gesture.
export function finishPostEnter(
  setOptions: (options: AnimationOptions) => void,
  closing: boolean,
  platform: string,
  reducedMotion: boolean
): void {
  if (closing) {
    return;
  }
  let animation: Animation =
    platform === "ios" ? "default" : "slide_from_right";
  if (reducedMotion) {
    animation = "fade";
  }
  setOptions({ animation });
}
