// Pull-to-refresh, shared by every scrollable that refreshes, so each screen
// gets the app's 3D loader instead of the stock RefreshControl.
//
// The pull is measured two different ways, because the platforms differ:
// iOS bounces natively, so the distance reads straight off the negative
// content offset. Android clamps that offset at zero, so a vertical pan
// captured at the top of the list measures the pull instead, with
// rubber-band resistance, running simultaneously with the list's own native
// scroll gesture.
//
// The two paths converge on the same refs, which is why the loader never
// needs to know which platform produced the distance.
//
// Everything is ref-driven on purpose: a pull gesture must not re-render the
// list on every frame. The screen only hands the hook its refresh function
// and refreshing flag, and the hook hands back the handlers, the two
// gestures, the shift value and a ready-made loader element.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Animated, Easing, Platform } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import type { SharedValue } from "react-native-reanimated";

import {
  PULL_THRESHOLD,
  PullLoader,
} from "@/features/feed/components/pull-loader";
import { REFRESH_TIMING } from "@/lib/lifecycle/refresh-timing";

import { pullDistance, pullGestureDecision } from "./android-pull";

// Where the Android list parks while refreshing: the 44px loader chip at
// top 12 plus breathing room.
const PULL_PARK = 64;

// Android pull, on native gestures: a JS responder loses the drag to the
// native scroll view the moment it starts, so the pull is a gesture-handler
// Pan running simultaneously with the list's own native scroll gesture. It
// only activates for a downward drag that starts at the top of the list.
// Scrolling back up from the middle never becomes a refresh. Horizontal drags fail it and
// stay with whatever horizontal gesture the screen owns (a pager, a
// swipe-back). Built once; the handlers only read refs.
function createNativeScrollGesture() {
  return Gesture.Native();
}

function createPullGestures(refs: {
  nativeScroll: ReturnType<typeof createNativeScrollGesture>;
  enabled: boolean;
  // The list's slide: follows the pull, parks under the loader while
  // refreshing, springs home otherwise.
  pullShift: Animated.Value;
  pullRef: RefObject<number>;
  pullUpdateRef: RefObject<((distance: number) => void) | null>;
  refreshRef: RefObject<() => void>;
  refreshingRef: RefObject<boolean>;
  scrollOffsetRef: RefObject<number>;
  scrollOffset?: Pick<SharedValue<number>, "get">;
}) {
  let baseline: number | null = null;
  let activated = false;
  let touchStart: { x: number; y: number } | null = null;
  const offset = () => refs.scrollOffset?.get() ?? refs.scrollOffsetRef.current;
  const resetPull = () => {
    baseline = null;
    refs.pullRef.current = 0;
    refs.pullUpdateRef.current?.(0);
  };
  const { nativeScroll } = refs;
  const pull = Gesture.Pan()
    .enabled(refs.enabled)
    .runOnJS(true)
    .manualActivation(true)
    .simultaneousWithExternalGesture(nativeScroll)
    .onTouchesDown((event, manager) => {
      activated = false;
      const [touch] = event.allTouches;
      touchStart = touch ? { x: touch.absoluteX, y: touch.absoluteY } : null;
      // A drag that starts down the feed belongs to scrolling for its entire lifetime.
      if (
        !touchStart ||
        offset() > 0 ||
        refs.refreshingRef.current ||
        event.numberOfTouches !== 1
      ) {
        touchStart = null;
        manager.fail();
      }
    })
    .onTouchesMove((event, manager) => {
      if (activated) {
        return;
      }
      const [touch] = event.allTouches;
      if (!touchStart || !touch) {
        manager.fail();
        return;
      }
      const decision = pullGestureDecision({
        offset: offset(),
        refreshing: refs.refreshingRef.current,
        touches: event.numberOfTouches,
        x: touch.absoluteX - touchStart.x,
        y: touch.absoluteY - touchStart.y,
      });
      if (decision === "fail") {
        manager.fail();
      } else if (decision === "activate") {
        activated = true;
        manager.activate();
      }
    })
    .onUpdate((event) => {
      if (refs.refreshingRef.current || offset() > 0) {
        if (refs.pullRef.current > 0) {
          resetPull();
          refs.pullShift.setValue(0);
        }
        return;
      }
      if (baseline === null) {
        baseline = event.translationY;
      }
      const distance = pullDistance(event.translationY, baseline);
      if (Math.abs(distance - refs.pullRef.current) > 1) {
        refs.pullRef.current = distance;
        refs.pullUpdateRef.current?.(distance);
        refs.pullShift.setValue(distance);
      }
    })
    .onFinalize((_event, success) => {
      const trigger =
        success &&
        offset() <= 0 &&
        !refs.refreshingRef.current &&
        refs.pullRef.current > PULL_THRESHOLD;
      touchStart = null;
      activated = false;
      if (!trigger && refs.pullRef.current === 0) {
        baseline = null;
        return;
      }
      if (trigger) {
        refs.refreshRef.current();
      }
      Animated.spring(refs.pullShift, {
        bounciness: 0,
        toValue: trigger ? PULL_PARK : 0,
        useNativeDriver: Platform.OS !== "web",
      }).start();
      resetPull();
    });
  return { nativeScroll, pull };
}

export interface PullToRefresh {
  // Wrap the shifting view in these, outermost first, exactly as the feed
  // does: the pan on the outer, the native scroll passthrough on the inner.
  gesture: ReturnType<typeof createPullGestures>["pull"];
  nativeScrollGesture: ReturnType<typeof createPullGestures>["nativeScroll"];
  // Hand to the scrollable's onScroll; it also feeds the iOS bounce path.
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  // UI-thread lists forward only top-edge crossings and bounce distances.
  onScrollOffset: (offsetY: number) => void;
  // Hand to the scrollable's onScrollEndDrag to fire the iOS trigger.
  onScrollEndDrag: () => void;
  // Applied as translateY on the view wrapping the scrollable.
  pullShift: Animated.Value;
  // Render next to the scrollable. Already wired to the loader and the glide
  // home that follows it.
  loader: React.ReactElement;
}

export function usePullToRefresh({
  failed,
  onRefresh,
  offsetTop,
  refreshing,
  scrollOffset,
  translucent = false,
  updatedMessage = "Feed updated",
}: {
  // The refresh that just finished failed: the pill says so.
  failed: boolean;
  onRefresh: () => void;
  // Where the chip rests. Screens that start under a notch or punch-hole pass
  // their safe-area inset here so the pill is never parked in the cutout.
  offsetTop?: number;
  refreshing: boolean;
  // UI-thread lists supply their authoritative offset, including restored positions.
  scrollOffset?: Pick<SharedValue<number>, "get">;
  // Set on screens where the chip drops over imagery rather than over the flat
  // page background, so what is behind it shows through.
  translucent?: boolean;
  // The pill's text. Defaults to the feed's, since that is the common case.
  updatedMessage?: string;
}): PullToRefresh {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [pullShift] = useState(() => new Animated.Value(0));
  const pullRef = useRef(0);
  // Pull distance writes here without re-rendering the list; PullLoader owns
  // the progress state and registers its setter through this ref.
  const pullUpdateRef = useRef<((distance: number) => void) | null>(null);
  // The Android pan reads both through refs, since it is built once.
  const scrollOffsetRef = useRef(0);
  const refreshingRef = useRef(refreshing);
  const refreshRef = useRef(onRefresh);
  // Crossing the top edge changes pull eligibility, but must never replace
  // the recognizer that currently owns the native scroll/fling.
  const nativeScroll = useMemo(() => createNativeScrollGesture(), []);

  // The gesture is built once, so it cannot close over these directly. An
  // effect mirrors them into refs, which is safe here precisely because the
  // gesture only reads them from a touch handler: effects have already run by
  // the time a pull can start.
  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);
  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  const gestures = useMemo(
    () =>
      // oxlint-disable-next-line react/refs -- gesture creation retains refs for touch callbacks, never reads them during render
      createPullGestures({
        enabled: Platform.OS === "android",
        nativeScroll,
        pullRef,
        pullShift,
        pullUpdateRef,
        refreshRef,
        refreshingRef,
        scrollOffset,
        scrollOffsetRef,
      }),
    [
      nativeScroll,
      pullRef,
      pullShift,
      pullUpdateRef,
      refreshRef,
      refreshingRef,
      scrollOffsetRef,
      scrollOffset,
    ]
  );

  // iOS: the native bounce carries the distance, so the scroll handler is the
  // pull handler. Progress stays local to PullLoader via the ref: no
  // re-render.
  const onScrollOffset = useCallback(
    (offsetY: number) => {
      scrollOffsetRef.current = offsetY;
      if (Platform.OS !== "ios") {
        return;
      }
      if (!refreshing && offsetY < 0) {
        const distance = -offsetY;
        if (Math.abs(distance - pullRef.current) > 1) {
          pullRef.current = distance;
          pullUpdateRef.current?.(distance);
        }
      } else if (pullRef.current > 0) {
        pullRef.current = 0;
        pullUpdateRef.current?.(0);
      }
    },
    [pullRef, pullUpdateRef, refreshing, scrollOffsetRef]
  );
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      onScrollOffset(event.nativeEvent.contentOffset.y);
    },
    [onScrollOffset]
  );

  const onScrollEndDrag = useCallback(() => {
    if (Platform.OS !== "ios") {
      return;
    }
    if (!refreshing && pullRef.current > PULL_THRESHOLD) {
      refreshRef.current();
    }
    pullRef.current = 0;
    pullUpdateRef.current?.(0);
  }, [pullRef, pullUpdateRef, refreshing]);

  // Fired as the loader starts sliding away, so the list glides home with it.
  // Same duration as the chip's exit: they are one motion, and the list used to
  // outlive the chip by 60ms, which read as the list dragging behind the pill.
  const onSettle = useCallback(() => {
    Animated.timing(pullShift, {
      duration: REFRESH_TIMING.chipExit,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
      toValue: 0,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [pullShift]);

  const loader = useMemo(
    () => (
      <PullLoader
        failed={failed}
        message={updatedMessage}
        offsetTop={offsetTop}
        onSettle={onSettle}
        refreshing={refreshing}
        registerUpdate={pullUpdateRef}
        translucent={translucent}
      />
    ),
    [
      failed,
      offsetTop,
      onSettle,
      pullUpdateRef,
      refreshing,
      translucent,
      updatedMessage,
    ]
  );

  return {
    gesture: gestures.pull,
    loader,
    nativeScrollGesture: gestures.nativeScroll,
    onScroll,
    onScrollEndDrag,
    onScrollOffset,
    pullShift,
  };
}
