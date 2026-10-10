import {
  GUST_ZOOM_REARM,
  gustZoomHome,
  gustZoomTransform,
} from "@asm/ui/lib/gust-zoom";
import { useEffect } from "react";
import { Gesture } from "react-native-gesture-handler";
import type { GestureType } from "react-native-gesture-handler";
import { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { haptic } from "@/lib/haptics";

export function useGustPinchZoom({
  enabled,
  mediaHeight,
  mediaWidth,
  onPinchStateChange,
  pagerGestures,
  viewportHeight,
  viewportWidth,
}: {
  enabled: boolean;
  mediaHeight: number;
  mediaWidth: number;
  onPinchStateChange: (active: boolean) => void;
  pagerGestures: readonly GestureType[];
  viewportHeight: number;
  viewportWidth: number;
}) {
  const transform = useSharedValue({ scale: 1, x: 0, y: 0 });
  const startScale = useSharedValue(1);
  const anchor = useSharedValue({ x: 0, y: 0 });
  const homeArmed = useSharedValue(false);
  const pinching = useSharedValue(false);
  const touchOrigin = useSharedValue({ x: 0, y: 0 });

  useEffect(() => {
    if (!enabled) {
      transform.set({ scale: 1, x: 0, y: 0 });
      homeArmed.set(false);
    }
  }, [enabled, homeArmed, transform]);

  // oxlint-disable-next-line react/capitalized-calls -- Gesture.Pinch is the gesture-handler builder
  const pinch = Gesture.Pinch()
    .enabled(enabled)
    .blocksExternalGesture(...pagerGestures)
    .onTouchesDown((event) => {
      const [touch] = event.allTouches;
      if (event.numberOfTouches === 1 && touch) {
        touchOrigin.set({ x: touch.x, y: touch.y });
      }
    })
    .onTouchesMove((event, manager) => {
      const [touch] = event.allTouches;
      if (event.numberOfTouches === 1 && !pinching.get() && touch) {
        const origin = touchOrigin.get();
        // Yield immediately to one-finger paging instead of waiting for touch-up.
        if (Math.hypot(touch.x - origin.x, touch.y - origin.y) > 8) {
          manager.fail();
        }
      }
    })
    .onStart((event) => {
      pinching.set(true);
      const current = transform.get();
      startScale.set(current.scale);
      anchor.set({
        x: (event.focalX - viewportWidth / 2 - current.x) / current.scale,
        y: (event.focalY - viewportHeight / 2 - current.y) / current.scale,
      });
      homeArmed.set(current.scale > GUST_ZOOM_REARM);
      scheduleOnRN(onPinchStateChange, true);
    })
    .onUpdate((event) => {
      const next = gustZoomTransform({
        anchorX: anchor.get().x,
        anchorY: anchor.get().y,
        focalX: event.focalX,
        focalY: event.focalY,
        mediaHeight,
        mediaWidth,
        scale: startScale.get() * event.scale,
        viewportHeight,
        viewportWidth,
      });
      transform.set(next);
      const home = gustZoomHome(next.scale, homeArmed.get());
      homeArmed.set(home.armed);
      if (home.reachedHome) {
        scheduleOnRN(haptic, "zoom-reset");
      }
    })
    .onFinalize(() => {
      if (pinching.get()) {
        pinching.set(false);
        scheduleOnRN(onPinchStateChange, false);
      }
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: transform.get().x },
      { translateY: transform.get().y },
      { scale: transform.get().scale },
    ],
  }));
  return { pinch, style };
}
