// Swipe pager for the home feed tabs. Dragging horizontally slides between
// tabs (personalized -> latest -> trending -> following); vertical gestures
// stay with the feed lists. Mirrors web's use-feed-swipe-navigation tuning:
// direction locks once the finger travels 10px, 56px of travel (or a fast
// flick) commits the swipe, edges clamp. Built on PanResponder + the core
// Animated API so no extra native dependency is needed.
//
// The responder config is rebuilt every render (cheap object creation) so
// handlers always close over current values - no latest-refs, which the
// React Compiler forbids writing during render.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Animated,
  Dimensions,
  PanResponder,
  StyleSheet,
  View,
} from "react-native";
import type {
  GestureResponderEvent,
  PanResponderGestureState,
} from "react-native";

// Horizontal travel (px) that commits a swipe on release, and the speed
// (px/ms) that commits a shorter flick. Same values as web.
const SWIPE_DISTANCE = 56;
const FLICK_VELOCITY = 0.6;
// Once the finger travels this far the gesture locks to horizontal or
// vertical; whichever axis is ahead wins.
const DIRECTION_LOCK = 10;

interface FeedPagerProps {
  activeIndex: number;
  children: ReactNode[];
  onIndexChange: (index: number) => void;
}

function clampIndex(index: number, pageCount: number): number {
  return Math.min(Math.max(0, index), Math.max(0, pageCount - 1));
}

export function FeedPager({
  activeIndex,
  children,
  onIndexChange,
}: FeedPagerProps) {
  const [pageWidth, setPageWidth] = useState(
    () => Dimensions.get("window").width
  );
  const translateX = useMemo(() => new Animated.Value(0), []);
  const pageCount = children.length;
  const clampedIndex = clampIndex(activeIndex, pageCount);
  const committedIndex = useRef(clampedIndex);
  const dragBase = useRef(0);

  const goTo = useCallback(
    (index: number) => {
      const next = clampIndex(index, pageCount);
      committedIndex.current = next;
      Animated.timing(translateX, {
        duration: 220,
        toValue: -next * pageWidth,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished && next !== activeIndex) {
          onIndexChange(next);
        }
      });
    },
    [activeIndex, onIndexChange, pageCount, pageWidth, translateX]
  );

  // Tab taps drive from the outside: slide to match. Swipe commits flow back
  // through onIndexChange instead, so this stays a one-way sync.
  useEffect(() => {
    // oxlint-disable-next-line react/refs -- syncing the animation position to prop changes must read the committed index here
    if (committedIndex.current !== clampedIndex) {
      goTo(clampedIndex);
    }
  }, [clampedIndex, goTo]);

  const shouldSetResponder = useCallback(
    (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      if (gesture.numberActiveTouches !== 1) {
        return false;
      }
      const horizontal = Math.abs(gesture.dx);
      const vertical = Math.abs(gesture.dy);
      return horizontal > DIRECTION_LOCK && horizontal > vertical;
    },
    []
  );

  const handleGrant = useCallback(() => {
    translateX.stopAnimation();
    dragBase.current = -committedIndex.current * pageWidth;
  }, [pageWidth, translateX]);

  const handleMove = useCallback(
    (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      const min = -(pageCount - 1) * pageWidth;
      const raw = dragBase.current + gesture.dx;
      translateX.setValue(Math.min(0, Math.max(min, raw)));
    },
    [pageCount, pageWidth, translateX]
  );

  const handleRelease = useCallback(
    (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      const { dx, vx } = gesture;
      let next = committedIndex.current;
      if (dx <= -SWIPE_DISTANCE || vx <= -FLICK_VELOCITY) {
        next = committedIndex.current + 1;
      } else if (dx >= SWIPE_DISTANCE || vx >= FLICK_VELOCITY) {
        next = committedIndex.current - 1;
      }
      goTo(next);
    },
    [goTo]
  );

  const handleTerminate = useCallback(() => {
    goTo(committedIndex.current);
  }, [goTo]);

  // Memoized so the responder identity is stable across renders. The config
  // closures only run on touch (never during render), which is exactly where
  // mutable gesture refs belong - the lint rule cannot see through
  // PanResponder.create, hence the targeted suppression.
  /* eslint-disable react/refs -- gesture handlers execute on touch events, never during render */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: shouldSetResponder,
        onPanResponderGrant: handleGrant,
        onPanResponderMove: handleMove,
        onPanResponderRelease: handleRelease,
        onPanResponderTerminate: handleTerminate,
      }),
    [
      handleGrant,
      handleMove,
      handleRelease,
      handleTerminate,
      shouldSetResponder,
    ]
  );
  /* eslint-enable react/refs */

  return (
    <View
      onLayout={(event) => {
        const { width } = event.nativeEvent.layout;
        if (width > 0 && width !== pageWidth) {
          setPageWidth(width);
          translateX.setValue(-committedIndex.current * width);
        }
      }}
      style={styles.viewport}
    >
      <Animated.View
        style={[
          styles.track,
          { transform: [{ translateX }], width: pageWidth * pageCount },
        ]}
        {...panResponder.panHandlers}
      >
        {children.map((child, index) => (
          <View key={index} style={[styles.page, { width: pageWidth }]}>
            {child}
          </View>
        ))}
      </Animated.View>
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
