import {
  GUST_SPEED_HOLD_MS,
  GUST_SPEED_HOLD_SLOP,
} from "@asm/ui/lib/gust-speed";
import { Gesture } from "react-native-gesture-handler";
import type { GestureType } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { opensGustProfile, PROFILE_SWIPE_SLOP } from "../lib/profile-swipe";

export function useGustMediaGestures({
  holdEnabled,
  onHoldState,
  onInteractionState,
  onOpenAuthor,
  onTap,
  pagerGestures,
  pinch,
  profileEnabled,
  tapEnabled,
  viewportWidth,
}: {
  holdEnabled: boolean;
  onHoldState: (active: boolean) => void;
  onInteractionState: (active: boolean) => void;
  onOpenAuthor: () => void;
  onTap: (x: number, y: number) => void;
  pagerGestures: readonly GestureType[];
  pinch: GestureType;
  profileEnabled: boolean;
  tapEnabled: boolean;
  viewportWidth: number;
}) {
  const profileSwipeActive = useSharedValue(false);
  const speedHoldActive = useSharedValue(false);
  // oxlint-disable-next-line react/capitalized-calls -- Gesture.Pan is the gesture-handler builder.
  const profileSwipe = Gesture.Pan()
    .enabled(profileEnabled)
    .activeOffsetX(-PROFILE_SWIPE_SLOP)
    .failOffsetX(PROFILE_SWIPE_SLOP)
    .failOffsetY([-PROFILE_SWIPE_SLOP, PROFILE_SWIPE_SLOP])
    .maxPointers(1)
    .requireExternalGestureToFail(pinch)
    .simultaneousWithExternalGesture(...pagerGestures)
    .onTouchesDown((event, manager) => {
      if (event.numberOfTouches > 1) {
        manager.fail();
      }
    })
    .onStart(() => {
      profileSwipeActive.set(true);
      scheduleOnRN(onInteractionState, true);
    })
    .onEnd((event, success) => {
      // Clear the active state before navigation can detach the gesture's view.
      profileSwipeActive.set(false);
      scheduleOnRN(onInteractionState, false);
      if (
        success &&
        opensGustProfile({
          translationX: event.translationX,
          translationY: event.translationY,
          velocityX: event.velocityX,
          viewportWidth,
        })
      ) {
        scheduleOnRN(onOpenAuthor);
      }
    })
    .onFinalize(() => {
      if (profileSwipeActive.get()) {
        profileSwipeActive.set(false);
        scheduleOnRN(onInteractionState, false);
      }
    });
  // oxlint-disable-next-line react/capitalized-calls -- Gesture.Tap is the gesture-handler builder.
  const mediaTap = Gesture.Tap()
    .enabled(tapEnabled)
    .maxDuration(GUST_SPEED_HOLD_MS)
    .maxDistance(12)
    .requireExternalGestureToFail(pinch)
    .simultaneousWithExternalGesture(...pagerGestures)
    .onTouchesDown((event, manager) => {
      if (event.numberOfTouches > 1) {
        manager.fail();
      }
    })
    .onEnd((event, success) => {
      if (success) {
        scheduleOnRN(onTap, event.x, event.y);
      }
    });
  // A hold never waits for pinch recognition or blocks one-finger paging.
  // oxlint-disable-next-line react/capitalized-calls -- Gesture.LongPress is the gesture-handler builder.
  const speedHold = Gesture.LongPress()
    .enabled(holdEnabled)
    .minDuration(GUST_SPEED_HOLD_MS)
    .maxDistance(GUST_SPEED_HOLD_SLOP)
    .numberOfPointers(1)
    .simultaneousWithExternalGesture(pinch, ...pagerGestures)
    .onTouchesDown((event, manager) => {
      if (event.numberOfTouches > 1) {
        manager.fail();
      }
    })
    .onStart(() => {
      speedHoldActive.set(true);
      scheduleOnRN(onInteractionState, true);
      scheduleOnRN(onHoldState, true);
    })
    .onFinalize(() => {
      if (speedHoldActive.get()) {
        speedHoldActive.set(false);
        scheduleOnRN(onHoldState, false);
        scheduleOnRN(onInteractionState, false);
      }
    });
  // oxlint-disable-next-line react/capitalized-calls -- Gesture.Race composes native recognizers without per-frame JS callbacks.
  return Gesture.Race(profileSwipe, speedHold, mediaTap);
}
