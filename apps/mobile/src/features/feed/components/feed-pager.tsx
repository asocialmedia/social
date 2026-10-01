// Swipe pager for the home feed tabs, UI-thread driven.
// Dragging horizontally slides between tabs; vertical gestures stay with the
// feed lists. Built on Reanimated shared values + Gesture Handler so the track
// follows the finger at 60fps without re-rendering React per frame (the old
// PanResponder + Animated.Value did all moves on the JS thread, which dropped
// frames while lists mounted).
// Only the active tab plus neighbours mount their lists; far tabs render an
// empty page of the same width so geometry stays exact while mount cost drops
// from four lists to at most three.
// Handoff + settle math lives in lib/pager-navigation and is unchanged.
// Worklet rule: gesture callbacks never capture JS refs. Everything the UI
// thread touches is a shared value; the two scheduleOnRN hops (drag flag,
// index publish) run on the RN thread through stable callbacks.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { clampIndex, handoffIndex, settleIndex } from "../lib/pager-navigation";

// Tap-driven index change animation. Fast ease-out, same feel as the tab
// indicator (220ms).
const TAP_DURATION = 220;
// Finger-driven settle uses a spring so velocity carries through.
const SETTLE_SPRING = { dampingRatio: 0.8, duration: 400 } as const;
// Strong ease-out for tap animations.
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

interface FeedPagerProps {
  activeIndex: number;
  children: ReactNode[];
  onIndexChange: (index: number) => void;
}

export function FeedPager({
  activeIndex,
  children,
  onIndexChange,
}: FeedPagerProps) {
  const pageCount = children.length;
  const clampedIndex = clampIndex(activeIndex, pageCount);
  // Start on the active page, not page 0: otherwise the first paint shows
  // the wrong tab and slides over, which reads as a glitch.
  const translateX = useSharedValue(
    -clampedIndex * Dimensions.get("window").width
  );
  // The first index set is the mount, not a tap: place without animating.
  const firstSettled = useRef(true);
  const widthSv = useSharedValue(Dimensions.get("window").width);
  const countSv = useSharedValue(pageCount);
  const originSv = useSharedValue(clampedIndex);
  const baseSv = useSharedValue(-clampedIndex * Dimensions.get("window").width);
  const handedSv = useSharedValue(clampedIndex);
  const draggingSv = useSharedValue(false);
  const [pageWidth, setPageWidth] = useState(
    () => Dimensions.get("window").width
  );
  useEffect(() => {
    widthSv.set(pageWidth);
  }, [pageWidth, widthSv]);
  useEffect(() => {
    countSv.set(pageCount);
  }, [countSv, pageCount]);

  // RN-thread hops for the gesture. Stable callbacks so the gesture memo
  // below never re-creates per render.
  const setDragging = useCallback(
    (value: boolean): void => {
      draggingSv.set(value);
    },
    [draggingSv]
  );

  const publishIndex = useCallback(
    (index: number): void => {
      onIndexChange(index);
    },
    [onIndexChange]
  );

  // Tap-driven index change: animate the track to the new page. Stands down
  // while a live drag owns the track; the gesture's own settle animates it.
  // Reads draggingSv in an effect (RN thread), never during render.
  useEffect(() => {
    if (draggingSv.get()) {
      return;
    }
    if (firstSettled.current) {
      firstSettled.current = false;
      translateX.set(-clampedIndex * pageWidth);
    } else {
      translateX.set(
        withTiming(-clampedIndex * pageWidth, {
          duration: TAP_DURATION,
          easing: EASE_OUT,
        })
      );
    }
    originSv.set(clampedIndex);
    baseSv.set(-clampedIndex * pageWidth);
    handedSv.set(clampedIndex);
  }, [
    baseSv,
    clampedIndex,
    draggingSv,
    handedSv,
    originSv,
    pageWidth,
    translateX,
  ]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }],
    width: widthSv.get() * countSv.get(),
  }));

  /* eslint-disable react/capitalized-calls -- Gesture.Pan is a factory, not a component */
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-12, 12])
        .onBegin(() => {
          draggingSv.set(true);
          scheduleOnRN(setDragging, true);
          const origin = clampIndex(originSv.get(), countSv.get());
          originSv.set(origin);
          handedSv.set(origin);
          baseSv.set(-origin * widthSv.get());
        })
        .onUpdate((event) => {
          const width = widthSv.get();
          const count = countSv.get();
          const min = -(count - 1) * width;
          const raw = baseSv.get() + event.translationX;
          const clamped = Math.min(0, Math.max(min, raw));
          translateX.set(clamped);
          const next = handoffIndex(originSv.get(), event.translationX, count);
          if (next !== handedSv.get()) {
            handedSv.set(next);
            scheduleOnRN(publishIndex, next);
          }
        })
        .onEnd((event) => {
          draggingSv.set(false);
          scheduleOnRN(setDragging, false);
          const count = countSv.get();
          const width = widthSv.get();
          const origin = originSv.get();
          // Gesture velocity is px/sec; settle math wants px/ms.
          const settled = settleIndex(
            origin,
            event.translationX,
            event.velocityX / 1000,
            count
          );
          originSv.set(settled);
          handedSv.set(settled);
          baseSv.set(-settled * width);
          translateX.set(withSpring(-settled * width, SETTLE_SPRING));
          scheduleOnRN(publishIndex, settled);
        })
        .onFinalize(() => {
          draggingSv.set(false);
          scheduleOnRN(setDragging, false);
        }),
    [
      baseSv,
      draggingSv,
      handedSv,
      originSv,
      countSv,
      publishIndex,
      setDragging,
      translateX,
      widthSv,
    ]
  );
  /* eslint-enable react/capitalized-calls */

  return (
    <View
      onLayout={(event) => {
        const { width } = event.nativeEvent.layout;
        if (width > 0 && width !== pageWidth) {
          setPageWidth(width);
          if (!draggingSv.get()) {
            translateX.set(-clampedIndex * width);
            baseSv.set(-clampedIndex * width);
          }
        }
      }}
      style={styles.viewport}
    >
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.track, animatedStyle]}>
          {children.map((child, index) => {
            const near = Math.abs(index - clampedIndex) <= 1;
            return (
              <View key={index} style={[styles.page, { width: pageWidth }]}>
                {near ? child : null}
              </View>
            );
          })}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  track: {
    flex: 1,
    flexDirection: "row",
  },
  viewport: {
    flex: 1,
    overflow: "hidden",
  },
});
