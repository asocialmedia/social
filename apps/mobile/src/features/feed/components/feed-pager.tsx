// Swipe pager for the home feed tabs. Dragging horizontally slides between
// tabs (personalized -> latest -> trending -> following); vertical gestures
// stay with the feed lists. Mirrors web's use-feed-swipe-navigation tuning:
// direction locks once the finger travels 10px, 56px of travel (or a fast
// flick) commits the swipe, edges clamp. Built on PanResponder + the core
// Animated API so no extra native dependency is needed.
//
// The tab hand-off happens mid-drag, not on the animation's completion: the
// incoming tab is enabled (and fetching) while the finger is still down, so
// the page the slide lands on is already painted. The index math behind both
// the hand-off and the release lives in lib/pager-navigation.
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
  Platform,
  StyleSheet,
  View,
} from "react-native";
import type {
  GestureResponderEvent,
  PanResponderGestureState,
} from "react-native";

import {
  DIRECTION_LOCK,
  clampIndex,
  handoffIndex,
  settleIndex,
} from "../lib/pager-navigation";

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
  const [pageWidth, setPageWidth] = useState(
    () => Dimensions.get("window").width
  );
  const translateX = useMemo(() => new Animated.Value(0), []);
  const pageCount = children.length;
  const clampedIndex = clampIndex(activeIndex, pageCount);
  const committedIndex = useRef(clampedIndex);
  const dragBase = useRef(0);
  // The page a live drag started from. A hand-off may already have moved the
  // active tab elsewhere, so the release has to measure its travel from here
  // to stay able to spring back.
  const dragOrigin = useRef(clampedIndex);
  // The page last handed over during this drag, so a move only reports an
  // actual change instead of re-publishing on every touch event.
  const handedOver = useRef(clampedIndex);
  const dragging = useRef(false);
  // Set by a release that already started its settle tween, so the sync
  // effect below does not restart the same animation one frame later.
  const settled = useRef<number | null>(null);

  const goTo = useCallback(
    (index: number) => {
      const next = clampIndex(index, pageCount);
      committedIndex.current = next;
      Animated.timing(translateX, {
        duration: 220,
        toValue: -next * pageWidth,
        useNativeDriver: Platform.OS !== "web",
      }).start(({ finished }) => {
        if (finished) {
          return;
        }
        // An interrupted animation must never strand the track between
        // pages: snap to the committed page (the sync effect below then
        // animates anywhere it still needs to go).
        translateX.setValue(-committedIndex.current * pageWidth);
      });
    },
    [pageCount, pageWidth, translateX]
  );

  // Tab taps drive from the outside, and width changes (rotation) flow in
  // through goTo's identity, so this always converges the track to the
  // clamped page: a mid-gesture measuring change can never leave it
  // stranded. Two cases stand down. A live drag owns the track - its moves
  // write translateX directly and the release decides where it lands. And a
  // release that already named this page is mid-settle toward it, so
  // re-animating would restart its tween and stall the slide.
  useEffect(() => {
    if (settled.current !== null) {
      const alreadySettling = settled.current === clampedIndex;
      settled.current = null;
      if (alreadySettling) {
        return;
      }
    }
    if (dragging.current) {
      return;
    }
    goTo(clampedIndex);
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
    dragging.current = true;
    const origin = committedIndex.current;
    dragOrigin.current = origin;
    handedOver.current = origin;
    dragBase.current = -origin * pageWidth;
  }, [pageWidth, translateX]);

  const handleMove = useCallback(
    (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      const min = -(pageCount - 1) * pageWidth;
      const raw = dragBase.current + gesture.dx;
      translateX.setValue(Math.min(0, Math.max(min, raw)));
      // Hand the tab over as soon as the drag points at a neighbour. The
      // incoming feed starts fetching now, so its posts (and anything else
      // that mounts per tab) are ready when the track settles instead of
      // popping in a beat after the slide lands.
      const next = handoffIndex(dragOrigin.current, gesture.dx, pageCount);
      if (next !== handedOver.current) {
        handedOver.current = next;
        onIndexChange(next);
      }
    },
    [onIndexChange, pageCount, pageWidth, translateX]
  );

  // The release publishes the page it lands on before animating to it, so the
  // tab strip and the enabled feed are already right while the track is still
  // sliding. A spring-back publishes the origin, taking back the mid-drag
  // hand-off.
  const settle = useCallback(
    (index: number) => {
      dragging.current = false;
      settled.current = index;
      onIndexChange(index);
      goTo(index);
    },
    [goTo, onIndexChange]
  );

  const handleRelease = useCallback(
    (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      settle(
        settleIndex(dragOrigin.current, gesture.dx, gesture.vx, pageCount)
      );
    },
    [pageCount, settle]
  );

  const handleTerminate = useCallback(() => {
    settle(dragOrigin.current);
  }, [settle]);

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
