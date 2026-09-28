// Shared opacity pulse for skeleton placeholders.
//
// Driven on the native thread via reanimated so it keeps running smoothly
// while the JS thread is busy parsing the response the user is waiting for,
// which is exactly when a setState-driven pulse would stutter. Honours the
// reduced-motion setting by holding a steady mid opacity, since the shape of
// the placeholder is what communicates "loading", not the motion.
import { useEffect } from "react";
import type { SharedValue } from "react-native-reanimated";
import {
  cancelAnimation,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

export function useSkeletonPulse(): SharedValue<number> {
  const reduceMotion = useReducedMotion();
  // The reduced-motion value is the resting opacity, so nothing needs to
  // animate or be reassigned when the setting is on.
  const pulse = useSharedValue(reduceMotion ? 0.6 : 0.45);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    // Writing .value is how a reanimated SharedValue is driven; the immutability
    // rule assumes hook results are read-only, which does not hold for the
    // native-thread animation values reanimated is built around.
    // oxlint-disable-next-line react/immutability
    pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
    return () => {
      cancelAnimation(pulse);
    };
  }, [pulse, reduceMotion]);

  return pulse;
}
