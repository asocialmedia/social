import { useMemo } from "react";
import { Gesture } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";

export function useTabSwipe(onNavigate: (direction: -1 | 1) => void) {
  return useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- Gesture.Pan constructs a native gesture.
      Gesture.Pan()
        .activeOffsetX([-24, 24])
        .failOffsetY([-12, 12])
        .onEnd((event) => {
          if (
            Math.abs(event.translationX) >= 56 ||
            Math.abs(event.velocityX) >= 600
          ) {
            scheduleOnRN(onNavigate, event.translationX < 0 ? 1 : -1);
          }
        }),
    [onNavigate]
  );
}
