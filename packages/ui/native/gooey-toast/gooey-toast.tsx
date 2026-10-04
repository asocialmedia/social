import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { STATE_ICONS } from "./icons";
import {
  clamp,
  resolvePlacement,
  SWIPE_DISMISS_DISTANCE,
  SWIPE_MAX_TRANSLATE,
} from "./internal";
import { isTimedDuration } from "./store";
import type { ToastRecord } from "./store";
import {
  BADGE_ICON_SIZE,
  BADGE_SIZE,
  BADGE_TOP_COLOR,
  BUTTON_TINT_RATIO,
  CONTENT_REVEAL_RATIO,
  DEFAULT_FILL,
  DEFAULT_ROUNDNESS,
  DESCRIPTION_COLOR,
  GOOEY_DURATION_MS,
  GOOEY_EASE,
  GOOEY_JOIN,
  INSET_SHADOW,
  OUTER_SHADOW,
  STATE_TONES,
  TITLE_COLOR,
  TOAST_HEIGHT,
  TOAST_WIDTH,
  toneAlpha,
  TRACK_TINT_RATIO,
} from "./theme";
import type { ToastRenderable } from "./types";

export interface GooeyToastProps {
  // Hover on web becomes press-in on native. The manager owns the shared
  // "is any toast being touched" flag, so dismiss timers pause across the whole
  // stack rather than only the toast under the finger. Pressing also expands the
  // toast, which is what upstream's `mouseenter` does.
  onPressIn: () => void;
  onPressOut: () => void;
  onDismiss: (id: string) => void;
  progress: number;
  record: ToastRecord;
}

// Upstream resolves a renderable through any number of `() => value` thunks.
const resolveRenderableValue = (input: ToastRenderable): ReactNode => {
  let value: unknown = input;
  let guard = 0;
  while (typeof value === "function" && guard < 10) {
    value = (value as () => unknown)();
    guard += 1;
  }
  // An absent renderable arrives as `undefined` (the option was simply not
  // passed), so it has to normalise to `null` like every other "nothing to
  // draw" case. Returning `undefined` here made `resolvedIcon === null` false
  // for a toast with no custom icon, so the badge never rendered and
  // contributed zero width to the measured pill; the same check drives
  // `hasContent`, which would claim an empty toast was expandable.
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value);
    // Upstream drops whitespace-only renderables (`if (!text.trim())`).
    return text.trim() ? text : null;
  }
  return value as ReactNode;
};

const isTextNode = (value: ReactNode): value is string | number =>
  typeof value === "string" || typeof value === "number";

// Upstream renders a `description` renderable straight into its container. A
// string needs wrapping in a `<Text>` to lay out; any other ReactNode is already
// renderable as-is.
function renderDescription(node: ReactNode): ReactNode {
  if (node === null) {
    return null;
  }
  if (!isTextNode(node)) {
    return node;
  }
  return <Text style={styles.description}>{node}</Text>;
}

// Same contract for the `icon` renderable, minus the text style: upstream lets
// the caller's node keep whatever styling it brought with it.
function renderIcon(node: ReactNode): ReactNode {
  if (!isTextNode(node)) {
    return node;
  }
  return <Text style={styles.iconText}>{node}</Text>;
}

// Upstream `measureHeaderWidth` adds a 2px safety margin on top of the measured
// content so a fractional glyph edge never clips the pill's right border.
const HEADER_MEASURE_SAFETY = 2;

// Upstream `alignedX`: a right-aligned viewport pushes the shape to the right
// edge, a centred one halves the leftover space. Runs on the UI thread so the
// pill and body both position themselves from one shared value.
function alignedX(
  width: number,
  align: "left" | "center" | "right",
  containerWidth: number
): number {
  "worklet";
  if (align === "right") {
    return containerWidth - width;
  }
  if (align === "center") {
    return (containerWidth - width) / 2;
  }
  return 0;
}

export function GooeyToast({
  onDismiss,
  onPressIn,
  onPressOut,
  progress,
  record,
}: GooeyToastProps) {
  const {
    button,
    description,
    fill = DEFAULT_FILL,
    // `width` / `height` mirror web's `--gooey-width` / `--gooey-height`. Web
    // overrides them in a stylesheet, so they arrive here as per-toast options.
    height: toastHeight = TOAST_HEIGHT,
    icon,
    id,
    roundness = DEFAULT_ROUNDNESS,
    state,
    title,
    width: toastWidth = TOAST_WIDTH,
  } = record;

  const resolvedDescription = useMemo(
    () => resolveRenderableValue(description),
    [description]
  );
  const resolvedIcon = useMemo(() => resolveRenderableValue(icon), [icon]);

  // Upstream defaults a missing title to the state name.
  const resolvedTitle = title ?? state;
  const hasContent = resolvedDescription !== null || button !== null;

  const placement = useMemo(
    () => resolvePlacement(record.position),
    [record.position]
  );
  const { align } = placement;
  const isTopEdge = placement.edge === "top";

  // Mirrors upstream `canExpand`: there must be content, the toast must not be
  // loading, and it must not already be exiting.
  const canExpand = hasContent && state !== "loading" && !record.exiting;

  const [expanded, setExpanded] = useState(false);
  const [containerWidth, setContainerWidth] = useState(toastWidth);

  // Geometry is held in shared values so the pill-to-body morph runs on the UI
  // thread over `--gooey-duration`, the way upstream transitions its rects.
  // The body width follows the pill when there is no content, per `applyGeometry`.
  const open = useSharedValue(0);
  const reveal = useSharedValue(0);
  const headerWidth = useSharedValue(toastHeight);
  const contentHeight = useSharedValue(0);

  const bodyWidth = hasContent ? containerWidth : toastWidth;
  const cornerRadius = Math.max(0, roundness);
  const tone = STATE_TONES[state];
  const StateIcon = STATE_ICONS[state];

  const showTimeoutIndicator =
    Boolean(record.timeoutIndicator) &&
    isTimedDuration(record.duration) &&
    !record.exiting;

  // Measure. `onLayout` replaces upstream's ResizeObserver plus its
  // `getBoundingClientRect` / `scrollHeight` measurement passes.
  const onContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      // `Math.ceil` matches upstream, avoiding a sub-pixel body that rounds away
      // to zero and never visibly opens.
      // oxlint-disable-next-line react/immutability -- assigning a Reanimated shared value is how an animation is started; the same pattern is used by Spinner3D's rotation
      contentHeight.value = Math.max(
        0,
        Math.ceil(event.nativeEvent.layout.height)
      );
    },
    [contentHeight]
  );

  const onHeaderMeasureLayout = useCallback(
    (event: LayoutChangeEvent) => {
      // Upstream measures `badge + title + gap + padding` from a hidden,
      // unconstrained copy of the header's own children
      // (`[data-gooey-title-measure]`, `width: max-content`, `visibility:
      // hidden`) rather than from the header itself, because the visible
      // header's width is the value being computed. Measuring the animated
      // header instead is self-referential: it starts collapsed at `toastHeight`,
      // reports exactly that back, and `clamp` pins the pill to the collapsed
      // minimum forever. The `> 0` guard matches upstream's, so a view that has
      // not been laid out yet cannot collapse the pill either.
      const measured = Math.ceil(event.nativeEvent.layout.width);
      if (measured <= 0) {
        return;
      }
      // Upstream clamps the header to [toastHeight, containerWidth]; a pill
      // wider than its container would overflow the viewport.
      // oxlint-disable-next-line react/immutability -- assigning a Reanimated shared value is how an animation is started; the same pattern is used by Spinner3D's rotation
      headerWidth.value = clamp(
        measured + HEADER_MEASURE_SAFETY,
        toastHeight,
        containerWidth
      );
    },
    [containerWidth, headerWidth, toastHeight]
  );

  const onRootLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0) {
      setContainerWidth(width);
    }
  }, []);

  // Autopilot. Upstream expands `autoExpandDelayMs` after the toast appears and
  // collapses again after `autoCollapseDelayMs`. A press cancels both, which is
  // upstream's `clearAutoPilotTimers()` on `mouseenter`.
  const autopilotTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearAutopilotTimers = useCallback(() => {
    for (const timer of autopilotTimers.current) {
      clearTimeout(timer);
    }
    autopilotTimers.current = [];
  }, []);

  useEffect(() => {
    if (!canExpand) {
      return;
    }
    const { autoCollapseDelayMs, autoExpandDelayMs } = record;
    // `resolveAutopilot` returns `{}` — not a pair of `null`s — when a toast
    // cannot auto-pilot (`autopilot: false`, or a null/zero duration). A delay
    // that was never set therefore arrives as `undefined`, so comparing against
    // `null` alone let both guards miss: every `autopilot: false` toast fell
    // through and scheduled its collapse at `undefined`, i.e. immediately.
    const collapseDelay =
      autoCollapseDelayMs === undefined ? null : autoCollapseDelayMs;
    const expandDelay =
      autoExpandDelayMs === undefined ? null : autoExpandDelayMs;
    if (expandDelay === null && collapseDelay === null) {
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    autopilotTimers.current = timers;
    // Upstream calls `setExpanded(true)` inline when the expand delay clamps to
    // zero. It goes through the same zero-delay timer as every other branch
    // here so the expansion lands on a later frame, which keeps the toast's
    // first paint from cascading into a synchronous state update.
    const expandAfter = Math.max(expandDelay ?? 0, 0);
    timers.push(
      setTimeout(() => {
        setExpanded(true);
      }, expandAfter)
    );
    if (collapseDelay !== null) {
      timers.push(
        setTimeout(() => {
          setExpanded(false);
        }, collapseDelay)
      );
    }
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      autopilotTimers.current = [];
    };
  }, [canExpand, record]);

  // Press-in stands in for web hover: it expands the toast and hands the pause
  // to the manager, which owns the shared "is any toast touched" flag.
  const handlePressIn = useCallback(() => {
    clearAutopilotTimers();
    onPressIn();
    if (canExpand) {
      setExpanded(true);
    }
  }, [canExpand, clearAutopilotTimers, onPressIn]);

  const handleActionPress = useCallback(() => {
    button?.onClick();
  }, [button]);

  // Upstream's `mouseleave` collapses and resumes; the manager debounces the
  // resume by HOVER_RESUME_DELAY so a quick tap cannot restart the timer early.
  const handlePressOut = useCallback(() => {
    setExpanded(false);
    onPressOut();
  }, [onPressOut]);

  // The loading spinner rotates continuously, mirroring `gooey-spin`.
  const spin = useSharedValue(0);
  useEffect(() => {
    if (state !== "loading") {
      return;
    }
    // oxlint-disable-next-line react/immutability -- assigning a Reanimated shared value is how an animation is started; the same pattern is used by Spinner3D's rotation
    spin.value = 0;
    // oxlint-disable-next-line react/immutability -- assigning a Reanimated shared value is how an animation is started; the same pattern is used by Spinner3D's rotation
    spin.value = withRepeat(
      withTiming(1, { duration: 1000, easing: Easing.linear }),
      -1,
      false
    );
    return () => {
      spin.value = 0;
    };
  }, [spin, state]);
  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  // Entry/exit. Upstream fades and translates by `--_entry-y` (8px for
  // bottom-edge toasts, -8px for top) while scaling 0.98 -> 1.
  const entry = useSharedValue(record.exiting ? 0 : 1);
  useEffect(() => {
    // oxlint-disable-next-line react/immutability -- assigning a Reanimated shared value is how an animation is started; the same pattern is used by Spinner3D's rotation
    entry.value = withTiming(record.exiting ? 0 : 1, {
      duration: GOOEY_DURATION_MS * 0.8,
      easing: Easing.bezier(...GOOEY_EASE),
    });
  }, [entry, record.exiting]);

  const entryStyle = useAnimatedStyle(() => ({
    opacity: entry.value,
    transform: [
      { translateY: entry.value * (isTopEdge ? -8 : 8) },
      { scale: 0.98 + entry.value * 0.02 },
    ],
  }));

  // The morph. Upstream transitions the pill and body rects' `x/y/width/height`
  // and the root `height` over `--gooey-duration`, so the surface grows rather
  // than jumping. `open` drives all of that geometry on the UI thread; `reveal`
  // runs at the shorter `0.7x` duration upstream uses for the content itself.
  useEffect(() => {
    // oxlint-disable-next-line react/immutability -- assigning a Reanimated shared value is how an animation is started; the same pattern is used by Spinner3D's rotation
    open.value = withTiming(canExpand && expanded ? 1 : 0, {
      duration: GOOEY_DURATION_MS,
      easing: Easing.bezier(...GOOEY_EASE),
    });
    // oxlint-disable-next-line react/immutability -- assigning a Reanimated shared value is how an animation is started; the same pattern is used by Spinner3D's rotation
    reveal.value = withTiming(canExpand && expanded ? 1 : 0, {
      duration: GOOEY_DURATION_MS * CONTENT_REVEAL_RATIO,
      easing: Easing.bezier(...GOOEY_EASE),
    });
  }, [canExpand, expanded, open, reveal]);

  // Upstream's `applyGeometry`, expressed as worklets over the measured widths.
  // `visualHeight` grows the root, `bodyHeight` unfolds the body below (top
  // edge) or above (bottom edge) the pill, and GOOEY_JOIN keeps them overlapping
  // so the two same-coloured surfaces read as one continuous shape.
  const rootGeometry = useAnimatedStyle(() => ({
    height: toastHeight + open.value * contentHeight.value,
    // The width comes from the record rather than from `styles.root`.
    // `TOAST_WIDTH` is only the library default; a shell that overrides
    // `--gooey-width` (web does, through a stylesheet) passes its own value per
    // toast, and `maxWidth: "100%"` then caps that against the viewport.
    width: toastWidth,
  }));

  const pillAnimatedProps = useAnimatedStyle(() => {
    // For a bottom-edge toast the pill sits at the bottom of the box, so it
    // travels down by exactly the content height as the body opens
    // (`pillY = visualHeight - toastHeight`, which is the open content height).
    const openHeight = open.value * contentHeight.value;
    return {
      height: toastHeight,
      left: alignedX(headerWidth.value, align, containerWidth),
      top: isTopEdge ? 0 : openHeight,
      width: headerWidth.value,
    };
  });

  const bodyAnimatedProps = useAnimatedStyle(() => ({
    height: open.value * (contentHeight.value + GOOEY_JOIN),
    left: alignedX(bodyWidth, align, containerWidth),
    top: isTopEdge ? toastHeight - GOOEY_JOIN : 0,
    width: bodyWidth,
  }));

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    height: toastHeight,
    left: alignedX(headerWidth.value, align, containerWidth),
    width: headerWidth.value,
  }));

  const contentAnimatedStyle = useAnimatedStyle(() => ({
    left: alignedX(bodyWidth, align, containerWidth),
    opacity: reveal.value,
    transform: [{ translateY: (1 - reveal.value) * (isTopEdge ? -3 : 3) }],
    width: bodyWidth,
  }));

  // Swipe to dismiss. Upstream tracks vertical pointer travel, clamps the
  // visual offset to SWIPE_MAX_TRANSLATE, and dismisses past
  // SWIPE_DISMISS_DISTANCE.
  const dragY = useSharedValue(0);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Claim the gesture only once it is clearly vertical, so a tap that
        // starts on the action button still lands on that button.
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          !record.exiting &&
          Math.abs(gesture.dy) > 2 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_evt, gesture) => {
          const sign = gesture.dy < 0 ? -1 : 1;
          // oxlint-disable-next-line react/immutability -- assigning a Reanimated shared value is how an animation is started; the same pattern is used by Spinner3D's rotation
          dragY.value =
            Math.min(Math.abs(gesture.dy), SWIPE_MAX_TRANSLATE) * sign;
        },
        onPanResponderRelease: (_evt, gesture) => {
          if (Math.abs(gesture.dy) >= SWIPE_DISMISS_DISTANCE) {
            onDismiss(id);
            return;
          }
          // oxlint-disable-next-line react/immutability -- assigning a Reanimated shared value is how an animation is started; the same pattern is used by Spinner3D's rotation
          dragY.value = withTiming(0, {
            duration: 150,
            easing: Easing.bezier(...GOOEY_EASE),
          });
        },
        onPanResponderTerminate: () => {
          // oxlint-disable-next-line react/immutability -- assigning a Reanimated shared value is how an animation is started; the same pattern is used by Spinner3D's rotation
          dragY.value = withTiming(0, { duration: 150 });
        },
      }),
    [dragY, id, onDismiss, record.exiting]
  );

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  // The badge is web's orange 3D chip. It is a plain rounded `View` rather than
  // an SVG gradient: at 22.4dp the two-stop `linear-gradient(to bottom, #ff9500,
  // #e65500)` is indistinguishable from its top colour, and drawing it with an
  // absolutely-filled `Svg` left the chip stretched out of round with the glyph
  // sitting outside it. A `View` with the chip's own radius and a centred glyph
  // has no layout path that can drift like that.

  // Upstream tints the glyph with the state tone inside a tinted circle; the web
  // shell replaces that circle with the orange chip and keeps the glyph white.
  const stateGlyph =
    state === "loading" ? (
      <Animated.View style={spinStyle}>
        <StateIcon color="#ffffff" size={BADGE_ICON_SIZE} />
      </Animated.View>
    ) : (
      <StateIcon color="#ffffff" size={BADGE_ICON_SIZE} />
    );

  // The web `drop-shadow` stack hangs off the SVG that draws the pill and body,
  // so here it hangs off the views that stand in for those rects.
  const surfaceStyle = [
    styles.surface,
    {
      backgroundColor: fill,
      borderRadius: cornerRadius,
      boxShadow: `${OUTER_SHADOW}, ${INSET_SHADOW}`,
    },
  ] as const;

  // The badge, title and the gap between them, rendered twice: once inside the
  // animated header, and once inside `styles.measure` for the intrinsic width
  // pass. Keeping one element means the measurement can never drift from what
  // actually draws.
  const headerContent = (
    <>
      <View style={styles.badgeHit}>
        {resolvedIcon === null ? (
          <View style={styles.badge}>{stateGlyph}</View>
        ) : (
          renderIcon(resolvedIcon)
        )}
      </View>

      <Text numberOfLines={1} style={styles.title}>
        {resolvedTitle}
      </Text>
    </>
  );

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      onLayout={onRootLayout}
      style={[styles.root, rootGeometry, entryStyle, dragStyle]}
      {...panResponder.panHandlers}
    >
      <Pressable
        accessibilityLabel={resolvedTitle}
        accessibilityRole="button"
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.pressTarget}
      >
        {/* The pill and the body are two opaque rounded rects in one colour.
            Upstream fuses them with an SVG gooey filter chain; React Native
            cannot run that filter (react-native-svg's Android blur is built on
            RenderScript, which no longer ships in Android), and at an opaque
            fill the GOOEY_JOIN overlap alone reads as one continuous surface. */}
        <Animated.View
          pointerEvents="none"
          style={[surfaceStyle, bodyAnimatedProps]}
        />
        <Animated.View
          pointerEvents="none"
          style={[surfaceStyle, pillAnimatedProps]}
        />

        {/* Upstream's `[data-gooey-title-measure]`: the header's own children,
            laid out without the animated width so the pill can be sized from
            their intrinsic width. Absolutely positioned so it never
            contributes to the toast's box, and inert so it is neither seen nor
            touched. `opacity` stands in for `visibility: hidden`, which
            React Native has no equivalent for. */}
        <View
          onLayout={onHeaderMeasureLayout}
          pointerEvents="none"
          style={styles.measure}
        >
          {headerContent}
        </View>

        <Animated.View
          style={[
            styles.header,
            isTopEdge ? styles.headerTop : styles.headerBottom,
            headerAnimatedStyle,
          ]}
        >
          {headerContent}
        </Animated.View>

        {hasContent ? (
          <Animated.View
            style={[
              styles.content,
              // Upstream anchors the content box to the pill: `top:
              // var(--gooey-height)` for a top-edge toast, `bottom` for a
              // bottom-edge one, so it always opens away from the edge.
              isTopEdge ? { top: toastHeight } : { bottom: toastHeight },
              contentAnimatedStyle,
            ]}
          >
            <View onLayout={onContentLayout} style={styles.contentInner}>
              {renderDescription(resolvedDescription)}
              {button ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={handleActionPress}
                  style={({ pressed }) => [
                    styles.action,
                    { backgroundColor: toneAlpha(tone, BUTTON_TINT_RATIO) },
                    // Upstream darkens the chip on hover.
                    pressed
                      ? {
                          backgroundColor: toneAlpha(
                            tone,
                            BUTTON_TINT_RATIO * 1.67
                          ),
                        }
                      : null,
                  ]}
                >
                  <Text style={[styles.actionText, { color: tone }]}>
                    {button.title}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </Animated.View>
        ) : null}

        {showTimeoutIndicator ? (
          <View
            pointerEvents="none"
            style={[
              styles.timeoutTrack,
              { backgroundColor: toneAlpha(tone, TRACK_TINT_RATIO) },
            ]}
          >
            <View
              style={[
                styles.timeoutFill,
                {
                  backgroundColor: toneAlpha(tone, 0.72),
                  transform: [{ scaleX: clamp(progress, 0, 1) }],
                },
              ]}
            />
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

// The `--gooey-header` gap and padding from the web shell stylesheet. The
// measure copy carries the same box because the width it reports is used as the
// pill's width, so that width already has to include the padding wrapping the
// badge and title.
const headerBox = {
  alignItems: "center",
  flexDirection: "row",
  gap: 8,
  paddingHorizontal: 16,
} as const;

const styles = StyleSheet.create({
  action: {
    alignSelf: "flex-start",
    borderRadius: 9999,
    height: 29,
    justifyContent: "center",
    marginTop: 12,
    paddingHorizontal: 10,
  },
  actionText: {
    fontFamily: "SofiaProBold",
    fontSize: 12,
  },
  badge: {
    alignItems: "center",
    backgroundColor: BADGE_TOP_COLOR,
    borderRadius: BADGE_SIZE / 2,
    height: BADGE_SIZE,
    justifyContent: "center",
    width: BADGE_SIZE,
  },
  badgeHit: {
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    position: "absolute",
  },
  contentInner: {
    paddingBottom: 15,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  description: {
    color: DESCRIPTION_COLOR,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 22,
  },
  header: {
    ...headerBox,
    // The header overlays the pill, so it spans the pill's full height and
    // `alignItems` (inherited from `headerBox`) centres the row in it.
    // Shrink-wrapped to its own content it sat flush against whichever edge it
    // was anchored to, leaving the badge and title hugging the bottom of a
    // bottom-edge toast's pill. `justifyContent` is deliberately NOT set here:
    // centring along the row's main axis collapses `flexShrink` on the title and
    // drops it from the pill entirely once the toast opens.
    position: "absolute",
  },
  headerBottom: {
    bottom: 0,
  },
  headerTop: {
    top: 0,
  },
  iconText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 12,
  },
  // The header's children laid out with no width of their own, so the layout
  // pass reports the width the content actually needs. Absolutely positioned
  // with only `left` and `top` set, which keeps Yoga sizing it to its content
  // rather than stretching it, and keeps it out of the toast's own box.
  measure: {
    ...headerBox,
    left: 0,
    opacity: 0,
    position: "absolute",
    top: 0,
  },
  // The press surface spans the whole toast, so pressing anywhere expands it the
  // way hovering anywhere does on web. The rects behind it are inert.
  pressTarget: {
    flex: 1,
  },
  root: {
    // Upstream's `width: min(var(--gooey-width), calc(100vw - 1.5rem))`: never
    // wider than the requested width, never wider than the viewport. The
    // requested width is supplied per toast by `rootGeometry`; the measured
    // `containerWidth` then drives the pill/body alignment.
    maxWidth: "100%",
    overflow: "visible",
  },
  surface: {
    position: "absolute",
  },
  timeoutFill: {
    borderRadius: 9999,
    height: 2,
    // The bar drains left-to-right, so the scale must grow from the left edge.
    transformOrigin: "left",
    width: "100%",
  },
  timeoutTrack: {
    borderRadius: 9999,
    bottom: 6,
    height: 2,
    left: 12,
    overflow: "hidden",
    position: "absolute",
    right: 12,
  },
  title: {
    color: TITLE_COLOR,
    flexShrink: 1,
    fontFamily: "SofiaProBold",
    fontSize: 14,
  },
});
