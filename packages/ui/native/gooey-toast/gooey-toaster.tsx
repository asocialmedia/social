import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GooeyToast } from "./gooey-toast";
import { clamp, HOVER_RESUME_DELAY } from "./internal";
import {
  dismissToast,
  isTimedDuration,
  setDefaultPosition,
  store,
} from "./store";
import type { ToastRecord } from "./store";
import { registerToaster } from "./toast";
import { TOAST_POSITIONS } from "./types";
import type { ToastPosition } from "./types";

export interface GooeyToasterProps {
  // `offset` mirrors upstream's number | per-edge object. A web viewport uses
  // fixed positioning; on native the same values become absolute insets.
  offset?:
    | number
    | Partial<Record<"top" | "right" | "bottom" | "left", number>>;
  position?: ToastPosition;
}

// Per-toast dismiss timer. Upstream keeps these keyed by `id:instanceId` so
// pause/resume survives re-renders and a reused id cannot inherit a timer.
interface DismissState {
  duration: number;
  remaining: number;
  // `null` means paused, which is what a press does on native.
  startedAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const now = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

// `[data-gooey-viewport] { padding: 0.75rem }`. The viewport style declares the
// horizontal pair and `resolveOffset` overrides the resolved edge, so this is
// the value on every edge before any offset is applied.
const BASE_VIEWPORT_PADDING = 12;

const timeoutKey = (record: ToastRecord): string =>
  `${record.id}:${record.instanceId}`;
export function GooeyToaster({ offset, position }: GooeyToasterProps) {
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<ToastRecord[]>(() => store.toasts);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [touching, setTouching] = useState(false);

  // Refs hold the imperative timer bookkeeping, so callbacks created once can
  // still read current values without re-subscribing to the store.
  const dismissStates = useRef(new Map<string, DismissState>());
  const touchingRef = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafId = useRef<number | null>(null);

  // Store subscription. Upstream's `ToasterManager` registers one listener in
  // its constructor and re-renders on every emit; this is the same contract.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- resyncing the external toast store is how this component learns about toasts that landed before its subscription was live
    setToasts(store.toasts);
    return store.subscribe((next) => {
      setToasts(next);
    });
  }, []);

  // `position` is the default placement for toasts raised while this toaster is
  // the active one. Upstream gets this from `createToaster({ position })`, which
  // writes the singleton manager's default; `buildToastRecord` falls back to that
  // same `store.position` when a caller passes no `position`. Without this sync
  // the prop is inert and every toast lands at the store default, `top-right`,
  // no matter what the mounted `<GooeyToaster position="...">` asked for.
  // Records already in the store were bucketed under the previous default, so
  // the default is applied through `setDefaultPosition`, which also re-homes
  // them. Upstream never needs that step because it mounts the toaster at
  // module scope, ahead of any toast; here the toaster is a component, so a
  // toast raised during splash or session bootstrap has already resolved
  // against the stale default.
  useEffect(() => {
    if (position !== undefined) {
      setDefaultPosition(position);
    }
  }, [position]);

  // Register as the active toaster so `configureToaster` / `unmountToaster`
  // reach this component, mirroring upstream's singleton manager.
  useEffect(() => {
    registerToaster({
      unmount: () => {
        store.update(() => []);
      },
      update: () => {
        // Toasts arrive through the store directly, so there is nothing to
        // push into the manager here.
      },
    });
    return () => {
      registerToaster(null);
    };
  }, []);

  const getRemaining = useCallback((state: DismissState, at = now()) => {
    if (state.startedAt === null) {
      return clamp(state.remaining, 0, state.duration);
    }
    return clamp(state.remaining - (at - state.startedAt), 0, state.duration);
  }, []);

  const deleteDismissState = useCallback((key: string) => {
    const state = dismissStates.current.get(key);
    if (state) {
      if (state.timer !== null) {
        clearTimeout(state.timer);
      }
      dismissStates.current.delete(key);
    }
  }, []);

  const clearDismissStates = useCallback(() => {
    // Deleting the entry being visited is well-defined on a `Map`, so this needs
    // no key snapshot.
    for (const key of dismissStates.current.keys()) {
      deleteDismissState(key);
    }
  }, [deleteDismissState]);

  // Schedule a timer for every timed, non-exiting toast that lacks one.
  // Mirrors upstream's `scheduleDismiss`.
  const scheduleDismiss = useCallback(
    (records: ToastRecord[]) => {
      if (touchingRef.current) {
        return;
      }
      for (const record of records) {
        if (record.exiting || !isTimedDuration(record.duration)) {
          continue;
        }
        const key = timeoutKey(record);
        let state = dismissStates.current.get(key);
        if (!state) {
          state = {
            duration: record.duration,
            remaining: record.duration,
            startedAt: null,
            timer: null,
          };
          dismissStates.current.set(key, state);
        }
        if (state.timer !== null) {
          continue;
        }
        state.remaining = clamp(state.remaining, 0, state.duration);
        state.startedAt = now();
        state.timer = setTimeout(() => {
          deleteDismissState(key);
          dismissToast(record.id);
        }, state.remaining);
      }
    },
    [deleteDismissState]
  );

  // Press-in pauses every running timer, matching upstream's hover behaviour.
  const pauseDismissTimers = useCallback(() => {
    const at = now();
    for (const state of dismissStates.current.values()) {
      if (state.timer === null) {
        continue;
      }
      clearTimeout(state.timer);
      state.remaining = getRemaining(state, at);
      state.startedAt = null;
      state.timer = null;
    }
  }, [getRemaining]);

  // Adopt the requested position as the store default. The `setDefaultPosition`
  // effect above is the sole path: it also re-homes unpinned records already in
  // the store. This second effect assigned `store.position` directly, skipped
  // that re-homing, and ran afterwards, so the outcome depended on effect order.

  // Upstream's `render` prunes dismiss states whose key has left the live set.
  // Without this a reused `id` keeps its predecessor's timer, which then
  // dismisses the replacement toast early.
  useEffect(() => {
    const liveKeys = new Set<string>();
    for (const record of toasts) {
      if (!record.exiting && isTimedDuration(record.duration)) {
        liveKeys.add(timeoutKey(record));
      }
    }
    for (const key of dismissStates.current.keys()) {
      if (!liveKeys.has(key)) {
        deleteDismissState(key);
      }
    }
  }, [deleteDismissState, toasts]);

  useEffect(() => {
    scheduleDismiss(toasts);
  }, [scheduleDismiss, toasts]);

  useEffect(() => clearDismissStates, [clearDismissStates]);
  const handlePressIn = useCallback(() => {
    if (resumeTimer.current !== null) {
      clearTimeout(resumeTimer.current);
      resumeTimer.current = null;
    }
    if (!touchingRef.current) {
      touchingRef.current = true;
      setTouching(true);
      pauseDismissTimers();
    }
  }, [pauseDismissTimers]);

  const handlePressOut = useCallback(() => {
    if (resumeTimer.current !== null) {
      clearTimeout(resumeTimer.current);
    }
    // The finger is already off this toast, so drop the touching flag now.
    // Leaving it set until the deferred check meant the check saw `true` and
    // bailed every time: one tap latched the toaster into "touching" for good,
    // so the dismiss timers never resumed and setTouching(false) never ran.
    touchingRef.current = false;
    // Upstream waits HOVER_RESUME_DELAY and re-checks that nothing is still
    // hovered before resuming, so a quick tap cannot restart the timer while
    // the finger is still down on another toast. A press that starts inside
    // the window sets the flag back and the check defers to it.
    resumeTimer.current = setTimeout(() => {
      resumeTimer.current = null;
      if (touchingRef.current) {
        return;
      }
      setTouching(false);
      scheduleDismiss(toasts);
    }, HOVER_RESUME_DELAY);
  }, [scheduleDismiss, toasts]);

  useEffect(
    () => () => {
      if (resumeTimer.current !== null) {
        clearTimeout(resumeTimer.current);
      }
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    },
    []
  );

  // Timeout progress. Upstream drives the bar from a rAF loop, recomputing
  // `remaining / duration` each frame and freezing it while hovered.
  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      if (cancelled) {
        return;
      }
      const next: Record<string, number> = {};
      let needsFrame = false;
      for (const record of toasts) {
        if (
          !record.timeoutIndicator ||
          record.exiting ||
          !isTimedDuration(record.duration)
        ) {
          continue;
        }
        const state = dismissStates.current.get(timeoutKey(record));
        const remaining = state ? getRemaining(state) : record.duration;
        const value = clamp(remaining / record.duration, 0, 1);
        next[timeoutKey(record)] = value;
        const paused = touching || state?.timer === null;
        if (!paused && value > 0) {
          needsFrame = true;
        }
      }
      setProgressMap(next);
      if (needsFrame) {
        rafId.current = requestAnimationFrame(tick);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };
  }, [getRemaining, touching, toasts]);

  // Bucket by position, exactly as upstream's `render` does, so several
  // viewports can coexist on one screen.
  const buckets = useMemo(() => {
    const map = new Map<ToastPosition, ToastRecord[]>();
    for (const record of toasts) {
      const list = map.get(record.position);
      if (list) {
        list.push(record);
      } else {
        map.set(record.position, [record]);
      }
    }
    return map;
  }, [toasts]);

  const resolveOffset = (edge: "top" | "right" | "bottom" | "left"): number => {
    // Upstream's `[data-gooey-viewport] { padding: 0.75rem }` is always on the
    // viewport and `offset` lands *on top of* it as an inset, so the base 12 is
    // unconditional. What was missing was the safe-area inset, which upstream
    // gets from the fixed viewport: every branch now adds its own edge's inset
    // so toasts clear the status bar and the gesture bar. Reading `insets.top`
    // for the horizontal edges would push them out by the status bar height, so
    // each edge reads only its own.
    //
    // `offset` is optional, so an omitted prop has to be treated the same as an
    // explicit null. Testing `=== null` alone would fall through to the indexed
    // read below and throw on the undefined.
    if (offset === null) {
      return 0;
    }
    if (typeof offset === "number") {
      return offset + insets[edge];
    }
    if (offset === undefined) {
      return BASE_VIEWPORT_PADDING + insets[edge];
    }
    return BASE_VIEWPORT_PADDING + (offset[edge] ?? 0) + insets[edge];
  };

  // Without an explicit offset, fall back to the safe-area inset plus padding,
  // so toasts clear the status bar and gesture bar the way a fixed web
  // viewport does.
  return (
    <View pointerEvents="box-none" style={styles.container}>
      {TOAST_POSITIONS.map((toastPosition) => {
        const records = buckets.get(toastPosition);
        if (!records?.length) {
          return null;
        }
        const isTop = toastPosition.startsWith("top");
        // Upstream pairs `[data-position$="left"]`, `$="right"` and `$="center"`
        // with `align-items: flex-start`, `flex-end` and `center`.
        let align: "center" | "flex-end" | "flex-start" = "center";
        if (toastPosition.endsWith("left")) {
          align = "flex-start";
        } else if (toastPosition.endsWith("right")) {
          align = "flex-end";
        }
        // Upstream's `[data-gooey-viewport]` rules, resolved per position. The
        // conditional padding is spread rather than ternary-nested so the keys
        // stay statically sortable.
        const viewportStyle = {
          alignItems: align,
          // Upstream anchors the viewport to the edge it grows from:
          // `[data-position^="top"] { top: 0 }` pairs with `[data-position^=
          // "bottom"] { bottom: 0 }`. This view is absolutely positioned, and an
          // absolute box with only `left` and `right` set resolves to `top: 0`,
          // so without this every bottom-edge toast renders at the top of the
          // screen instead of against the bottom edge.
          ...(isTop ? { top: 0 } : { bottom: 0 }),
          // Upstream pairs `[data-position^="top"]` with `column-reverse` and
          // `[data-position^="bottom"]` with `column`, so a new toast always lands
          // against the edge the viewport is anchored to.
          flexDirection: isTop
            ? ("column-reverse" as const)
            : ("column" as const),
          // `[data-gooey-viewport] { gap: 0.75rem }`.
          gap: 12,
          ...(toastPosition.endsWith("left")
            ? { paddingLeft: resolveOffset("left") }
            : {}),
          ...(toastPosition.endsWith("right")
            ? { paddingRight: resolveOffset("right") }
            : {}),
          ...(isTop
            ? { paddingTop: resolveOffset("top") }
            : { paddingBottom: resolveOffset("bottom") }),
        };
        return (
          <View
            key={toastPosition}
            pointerEvents="box-none"
            style={[styles.viewport, viewportStyle]}
          >
            {records.map((record) => {
              const key = `${record.id}:${record.instanceId}`;
              return (
                <GooeyToast
                  key={key}
                  onDismiss={dismissToast}
                  onPressIn={handlePressIn}
                  onPressOut={handlePressOut}
                  progress={progressMap[key] ?? 1}
                  record={record}
                />
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Upstream's `[data-gooey-viewport] { z-index: 9999 }`, kept verbatim so a
  // toast floats above every app surface the way it does on web. Without it the
  // viewport inherits zIndex 0 and the app's bottom dock (`zIndex: 50`) paints
  // over the toast, which swallows the pill and its badge at the bottom edge.
  container: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 9999,
  },
  viewport: {
    left: 0,
    maxWidth: "100%",
    paddingHorizontal: 12,
    position: "absolute",
    right: 0,
  },
});
