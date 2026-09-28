// Web's AnimatedWordCounter: `current / max` with a state that escalates as
// the limit approaches, and a nudge that pulses once when the count goes over.
//
// The pulse is the whole reason this is a component rather than a line of
// text. The counter has to be visible without being loud, so the number only
// moves when it crosses a threshold or exceeds the limit, and a plain
// re-render on every keystroke would either do nothing or flicker. The
// threshold colours come from the app's theme rather than web's utility
// classes, so both themes stay on the same ramp as everything around them.

import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

import { themeText } from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";

export interface AnimatedWordCounterProps {
  current: number;
  max: number;
}

export function AnimatedWordCounter({
  current,
  max,
}: AnimatedWordCounterProps) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const percentage = (current / max) * 100;
  const isNearLimit = percentage > 90;
  const isOverLimit = current > max;
  // An Animated.Value is a stable mutable instance, not render state: it is
  // driven by the animation driver and read in a style transform. useState
  // would be wrong here because the value is never replaced.
  // oxlint-disable-next-line react/refs
  const pulse = useRef(new Animated.Value(1)).current;
  const wasOver = useRef(false);

  // One pulse when the count crosses into over-limit, not on every keystroke
  // past it: repeating the animation on each character is a flicker.
  useEffect(() => {
    if (isOverLimit && !wasOver.current) {
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 100,
          toValue: 1.1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 100,
          toValue: 1,
          useNativeDriver: true,
        }),
      ]).start();
    }
    wasOver.current = isOverLimit;
  }, [isOverLimit, pulse]);

  // Three states, so a plain if-chain reads better than a nested ternary and
  // the near-limit colour can still follow the theme.
  let counterColor = text.muted;
  if (isNearLimit) {
    counterColor = isDark ? "#fbbf24" : "#b45309";
  }
  if (isOverLimit) {
    counterColor = text.destructive;
  }

  return (
    <View style={styles.row}>
      <View style={styles.warningSlot}>
        {isNearLimit ? (
          <Text style={[styles.warning, { color: counterColor }]}>
            {isOverLimit ? "Too many words" : "Approaching limit"}
          </Text>
        ) : null}
      </View>
      <Animated.Text
        style={[
          styles.current,
          { color: counterColor, transform: [{ scale: pulse }] },
        ]}
      >
        {current}
      </Animated.Text>
      <Text style={[styles.separator, { color: text.muted }]}>/</Text>
      <Text style={[styles.max, { color: text.muted }]}>{max}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  current: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  max: { fontFamily: "SofiaProReg", fontSize: 12 },
  row: { alignItems: "center", flexDirection: "row", gap: 2 },
  separator: { fontFamily: "SofiaProReg", fontSize: 12 },
  warning: {
    fontFamily: "SofiaProMed",
    fontSize: 11,
    left: 0,
    position: "absolute",
    top: -18,
  },
  // Reserved even when empty, so the row does not jump when the warning
  // appears near the limit.
  warningSlot: { height: 14 },
});
