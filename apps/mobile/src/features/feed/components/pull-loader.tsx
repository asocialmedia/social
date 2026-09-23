// Pull-to-refresh indicator for the feed, in the app's 3D material. A round
// panel-3d chip (hairline edge, bright inner lip, background-alt surface)
// carries web's Spinner3D and drops in from above as the list is pulled,
// growing from 70% to full size as the pull nears the release threshold.
// While refreshing it parks and spins. When the refresh settles the spinner
// hands over to an orange 3D check badge (a dark one with an X if the refresh
// failed), the chip widens into a pill while "Feed updated" slides in, holds,
// slides back out, the pill folds back into the chip, and the chip slides up
// out of view as the list glides home.
//
// Everything here is JS-driven: the pill animates its width, which the native
// driver cannot, and one driver per view keeps the sequence in one place.
import { Check, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { Spinner3D } from "@/components/feedback/spinner-3d";
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  APPLE_PANEL_SHADOWS,
  APPLE_PANEL_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

export const PULL_THRESHOLD = 90;

// `.panel-3d` on hsl(var(--background-alt)).
const CHIP_LIGHT = {
  background: "#f3f4f6",
  border: "rgba(0, 0, 0, 0.12)",
  shadows: APPLE_PANEL_SHADOWS,
} as const;
const CHIP_DARK = {
  background: "#171717",
  border: "rgba(255, 255, 255, 0.12)",
  shadows: APPLE_PANEL_SHADOWS_DARK,
} as const;

// The orange 3D badge (play-badge recipe: inner lip + dark-orange ring) and
// its dark counterpart for a failed refresh (the video pills' dark recipe).
const SUCCESS_BADGE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 2px 4px rgba(0, 0, 0, 0.12)";
const ERROR_BADGE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.45), 0 2px 4px rgba(0, 0, 0, 0.25)";

const CHIP_SIZE = 44;
const CHIP_BORDER = 1;
const ICON_SLOT = 28;
// (44 - 2 border - 28 slot) / 2: the slot sits dead centre in the chip.
const CHIP_INSET = (CHIP_SIZE - CHIP_BORDER * 2 - ICON_SLOT) / 2;
const LABEL_GAP = 8;
const LABEL_TRAIL = 14;
// Hidden above the list: the chip plus its top offset and shadow.
const HIDDEN_OFFSET = -(CHIP_SIZE + 24);

const SPRING_EASE = Easing.bezier(0.32, 0.72, 0, 1);
const CSS_EASE = Easing.bezier(0.25, 0.1, 0.25, 1);

function timing(
  value: Animated.Value,
  toValue: number,
  duration: number,
  easing: (t: number) => number = CSS_EASE
) {
  return Animated.timing(value, {
    duration,
    easing,
    toValue,
    useNativeDriver: false,
  });
}

export function PullLoader({
  failed,
  onSettle,
  refreshing,
  registerUpdate,
}: {
  // The refresh that just finished failed: the pill says so.
  failed: boolean;
  // Fired as the chip starts sliding away, so the list can glide home with
  // it.
  onSettle: () => void;
  refreshing: boolean;
  registerUpdate: RefObject<((distance: number) => void) | null>;
}) {
  const { isDark, theme } = useAppTheme();
  // Progress lives here so pull gestures do not re-render the list: FeedList
  // only writes the distance through the registered setter.
  const [progress, setProgress] = useState(0);
  const [labelWidth, setLabelWidth] = useState(0);
  // oxlint-disable-next-line react/hook-use-state -- stable Animated.Value created once; no setter is ever needed
  const [appear] = useState(() => new Animated.Value(0));
  // oxlint-disable-next-line react/hook-use-state -- stable Animated.Value created once; no setter is ever needed
  const [width] = useState(() => new Animated.Value(CHIP_SIZE));
  // oxlint-disable-next-line react/hook-use-state -- stable Animated.Value created once; no setter is ever needed
  const [badge] = useState(() => new Animated.Value(0));
  // oxlint-disable-next-line react/hook-use-state -- stable Animated.Value created once; no setter is ever needed
  const [label] = useState(() => new Animated.Value(0));
  const wasRefreshingRef = useRef(false);
  const settlingRef = useRef(false);
  const onSettleRef = useRef(onSettle);
  const labelWidthRef = useRef(0);

  useEffect(() => {
    onSettleRef.current = onSettle;
    labelWidthRef.current = labelWidth;
  }, [labelWidth, onSettle]);

  useEffect(() => {
    // oxlint-disable-next-line react/immutability -- ref-held setter registration, same as FeedScrollbar
    registerUpdate.current = setProgress;
    return () => {
      // oxlint-disable-next-line react/immutability -- clearing our registration on unmount
      registerUpdate.current = null;
    };
  }, [registerUpdate]);

  useEffect(() => {
    if (refreshing) {
      wasRefreshingRef.current = true;
      settlingRef.current = false;
      width.setValue(CHIP_SIZE);
      badge.setValue(0);
      label.setValue(0);
      // A refresh that did not come from a pull still shows the chip.
      const drop = timing(appear, 1, 220, SPRING_EASE);
      drop.start();
      return () => {
        drop.stop();
      };
    }
    if (!wasRefreshingRef.current) {
      return;
    }
    wasRefreshingRef.current = false;
    settlingRef.current = true;
    const pillWidth =
      CHIP_SIZE - CHIP_INSET + LABEL_GAP + labelWidthRef.current + LABEL_TRAIL;
    const done = Animated.sequence([
      // Spinner out, badge pops in.
      timing(badge, 1, 180, SPRING_EASE),
      // The chip widens into the pill while the label slides in.
      Animated.parallel([
        timing(width, pillWidth, 260, SPRING_EASE),
        Animated.sequence([Animated.delay(90), timing(label, 1, 200)]),
      ]),
      Animated.delay(1100),
      // Label slides back out, the pill folds back into the chip.
      timing(label, 0, 150),
      timing(width, CHIP_SIZE, 220, SPRING_EASE),
    ]);
    done.start(({ finished }) => {
      if (!finished) {
        settlingRef.current = false;
        return;
      }
      onSettleRef.current();
      timing(appear, 0, 240, SPRING_EASE).start(() => {
        settlingRef.current = false;
        badge.setValue(0);
      });
    });
    return () => {
      done.stop();
    };
  }, [appear, badge, label, refreshing, width]);

  // The pull drives the drop-in directly; a pull released short of the
  // threshold eases the chip back up. Declared after the refresh effect on
  // purpose: effects run in order, so when a refresh settles the settle
  // sequence claims the chip before this one could retreat it.
  const lastProgressRef = useRef(0);
  useEffect(() => {
    const released = lastProgressRef.current > 0 && progress <= 0;
    lastProgressRef.current = progress;
    if (refreshing || settlingRef.current) {
      return;
    }
    if (progress > 0) {
      appear.setValue(Math.min(1, progress / PULL_THRESHOLD));
      return;
    }
    if (!released) {
      return;
    }
    const retreat = timing(appear, 0, 160);
    retreat.start();
    return () => {
      retreat.stop();
    };
  }, [appear, progress, refreshing]);

  const chip = isDark ? CHIP_DARK : CHIP_LIGHT;
  const message = failed ? "Couldn't refresh" : "Feed updated";
  // Scale tracks the pull (70% -> 100%) and holds full size once parked.
  const scale = appear.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 1],
  });

  return (
    <View pointerEvents="none" style={styles.wrap}>
      {/* Measures the label once so the pill knows how wide to open. */}
      <Text
        onLayout={(event) => {
          setLabelWidth(Math.ceil(event.nativeEvent.layout.width));
        }}
        style={[styles.label, styles.measure]}
      >
        {message}
      </Text>
      <Animated.View
        style={{
          opacity: appear,
          transform: [
            {
              translateY: appear.interpolate({
                inputRange: [0, 1],
                outputRange: [HIDDEN_OFFSET, 0],
              }),
            },
            { scale },
          ],
        }}
      >
        <Animated.View
          style={[
            styles.chip,
            {
              backgroundColor: chip.background,
              borderColor: chip.border,
              boxShadow: chip.shadows,
              width,
            },
          ]}
        >
          <View style={styles.chipClip}>
            <View style={styles.iconSlot}>
              {refreshing || progress > 0 ? (
                <Animated.View
                  style={[
                    styles.iconLayer,
                    {
                      opacity: badge.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 0],
                      }),
                    },
                  ]}
                >
                  <Spinner3D size={ICON_SLOT} />
                </Animated.View>
              ) : null}
              <Animated.View
                style={[
                  styles.iconLayer,
                  {
                    opacity: badge,
                    transform: [
                      {
                        scale: badge.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.5, 1],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Gradient3D
                  colors={
                    failed ? ["#3a3f4a", "#23262e"] : ["#ff9500", "#e65500"]
                  }
                  shadows={failed ? ERROR_BADGE_SHADOWS : SUCCESS_BADGE_SHADOWS}
                  style={styles.badge}
                >
                  {failed ? (
                    <X color="#ffffff" size={14} strokeWidth={3} />
                  ) : (
                    <Check color="#ffffff" size={14} strokeWidth={3} />
                  )}
                </Gradient3D>
              </Animated.View>
            </View>
            <Animated.Text
              numberOfLines={1}
              style={[
                styles.label,
                // Pinned to the measured width: squeezed into the closed chip
                // it would ellipsize instead of being clipped.
                labelWidth > 0 ? { width: labelWidth } : null,
                {
                  color: theme.inputText,
                  opacity: label,
                  transform: [
                    {
                      translateX: label.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-10, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              {message}
            </Animated.Text>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    height: ICON_SLOT,
    width: ICON_SLOT,
  },
  chip: {
    borderRadius: 9999,
    borderWidth: CHIP_BORDER,
    height: CHIP_SIZE,
  },
  // Clips the label while the pill is still opening; the shadow lives on
  // the outer chip so the clip never cuts it.
  chipClip: {
    alignItems: "center",
    borderRadius: 9999,
    flex: 1,
    flexDirection: "row",
    gap: LABEL_GAP,
    overflow: "hidden",
    paddingLeft: CHIP_INSET,
  },
  iconLayer: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  iconSlot: {
    height: ICON_SLOT,
    width: ICON_SLOT,
  },
  label: {
    fontFamily: "SofiaProMed",
    fontSize: 13,
    fontWeight: "normal",
  },
  measure: {
    opacity: 0,
    position: "absolute",
    top: -1000,
  },
  wrap: {
    alignItems: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 12,
    zIndex: 20,
  },
});
