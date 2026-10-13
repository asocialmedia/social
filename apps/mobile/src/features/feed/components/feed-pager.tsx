// Swipe pager for the home feed tabs, UI-thread driven.
// Dragging horizontally slides between tabs; vertical gestures stay with the
// feed lists. Built on Reanimated shared values + Gesture Handler so the track
// follows the finger at 60fps without re-rendering React per frame (the old
// PanResponder + Animated.Value did all moves on the JS thread, which dropped
// frames while lists mounted).
// Preload neighbours, then retain pages that have mounted. Tab changes reuse
// measured rows and scroll positions instead of allocating a feed again while
// the swipe is settling. Inactive media releases its native decoding source.
// Handoff + settle math lives in lib/pager-navigation and is unchanged.
// Worklet rule: gesture callbacks never capture JS refs. Everything the UI
// thread touches is a shared value; index publication uses a stable RN callback.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import {
  clampIndex,
  handoffIndex,
  retainPagerPages,
  settleIndex,
  shouldSyncPagerTarget,
} from "../lib/pager-navigation";

// Finger-driven settle keeps velocity and honours reduced motion by default.
const SETTLE_SPRING = { dampingRatio: 1, duration: 400 } as const;

interface FeedPagerProps {
  activeIndex: number;
  children: ReactNode[];
  onIndexChange: (index: number) => void;
  overlay?: ReactNode;
}

export function FeedPager({
  activeIndex,
  children,
  onIndexChange,
  overlay,
}: FeedPagerProps) {
  const pageCount = children.length;
  const onIndexChangeRef = useRef(onIndexChange);
  useEffect(() => {
    onIndexChangeRef.current = onIndexChange;
  }, [onIndexChange]);
  const clampedIndex = clampIndex(activeIndex, pageCount);
  const [mountedRange, setMountedRange] = useState(() =>
    retainPagerPages(clampedIndex, pageCount)
  );
  const retained = retainPagerPages(clampedIndex, pageCount, mountedRange);
  if (retained !== mountedRange) {
    setMountedRange(retained);
  }
  // Start on the active page, not page 0: otherwise the first paint shows
  // the wrong tab and slides over, which reads as a glitch.
  const translateX = useSharedValue(
    -clampedIndex * Dimensions.get("window").width
  );
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

  // Index publication is the only RN-thread hop; drag ownership stays on the UI thread.
  const publishIndex = useCallback((index: number): void => {
    onIndexChangeRef.current(index);
  }, []);

  // Tap-driven index change: animate the track to the new page. Stands down
  // while a live drag owns the track; the gesture's own settle animates it.
  // Reads draggingSv in an effect (RN thread), never during render.
  useEffect(() => {
    if (
      !shouldSyncPagerTarget(
        clampedIndex,
        pageWidth,
        originSv.get(),
        baseSv.get(),
        draggingSv.get()
      )
    ) {
      return;
    }
    // A published swipe target already has a spring; only a new tap starts another one.
    translateX.set(withSpring(-clampedIndex * pageWidth, SETTLE_SPRING));
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

  // oxlint-disable react/refs -- Worklets schedule publishIndex; its ref is read later on the RN thread.
  const gesture = useMemo(
    () =>
      // oxlint-disable-next-line react/capitalized-calls -- Gesture.Pan is a factory, not a component
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-12, 12])
        .onStart(() => {
          cancelAnimation(translateX);
          draggingSv.set(true);
          const origin = clampIndex(originSv.get(), countSv.get());
          originSv.set(origin);
          handedSv.set(origin);
          baseSv.set(translateX.get());
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
        .onEnd((event, success) => {
          if (!success) {
            return;
          }
          draggingSv.set(false);
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
          translateX.set(
            withSpring(-settled * width, {
              ...SETTLE_SPRING,
              velocity: event.velocityX,
            })
          );
          scheduleOnRN(publishIndex, settled);
        })
        .onFinalize((_event, success) => {
          if (!success && draggingSv.get()) {
            const origin = clampIndex(originSv.get(), countSv.get());
            handedSv.set(origin);
            baseSv.set(-origin * widthSv.get());
            translateX.set(withSpring(-origin * widthSv.get(), SETTLE_SPRING));
            scheduleOnRN(publishIndex, origin);
          }
          draggingSv.set(false);
        }),
    [
      baseSv,
      draggingSv,
      handedSv,
      originSv,
      countSv,
      publishIndex,
      translateX,
      widthSv,
    ]
  );

  // oxlint-enable react/refs

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
        <View collapsable={false} style={styles.viewport}>
          <Animated.View style={[styles.track, animatedStyle]}>
            {children.map((child, index) => {
              const mounted = index >= retained.first && index <= retained.last;
              return (
                <View key={index} style={[styles.page, { width: pageWidth }]}>
                  {mounted ? child : null}
                </View>
              );
            })}
          </Animated.View>
          {overlay}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flexShrink: 0,
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
