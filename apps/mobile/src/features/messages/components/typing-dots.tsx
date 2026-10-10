// The "typing..." row under the last bubble.
//
// Three dots, each pulsing on its own offset. They are driven with the Animated
// API rather than Reanimated because three opacity values do not justify pulling a
// worklet onto the UI thread, and the animation is gated on reduced motion the same
// way web's `@media (prefers-reduced-motion)` block is.
import { useEffect, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  AccessibilityInfo,
} from "react-native";

import { useAppTheme } from "@/theme";

const DOT_COUNT = 3;
const PULSE_MS = 900;

export function TypingDots() {
  const { theme } = useAppTheme();
  // Created once and never replaced: these are animation handles, not render state,
  // so the array is built by a state initialiser rather than rebuilt on every
  // render, which would restart the pulse each time.
  // Built once by a state initialiser and never replaced: these are animation
  // handles, not render state, and rebuilding them each render would restart the
  // pulse every time.
  // oxlint-disable-next-line react/hook-use-state -- the value half only; there is nothing to set
  const [dots] = useState(() =>
    Array.from({ length: DOT_COUNT }, () => new Animated.Value(0))
  );

  useEffect(() => {
    let cancelled = false;
    let running: Animated.CompositeAnimation[] = [];

    // Respect the OS-level motion preference. The row still renders -- the peer is
    // typing and that is information -- it simply stops moving.
    void (async () => {
      const reduced = await AccessibilityInfo.isReduceMotionEnabled();
      if (cancelled || reduced) {
        return;
      }
      running = dots.map((value, index) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(index * (PULSE_MS / DOT_COUNT)),
            Animated.timing(value, {
              duration: PULSE_MS / 2,
              easing: Easing.inOut(Easing.quad),
              toValue: 1,
              useNativeDriver: true,
            }),
            Animated.timing(value, {
              duration: PULSE_MS / 2,
              easing: Easing.inOut(Easing.quad),
              toValue: 0,
              useNativeDriver: true,
            }),
          ])
        )
      );
      for (const animation of running) {
        animation.start();
      }
    })();

    return () => {
      cancelled = true;
      for (const animation of running) {
        animation.stop();
      }
      for (const value of dots) {
        value.stopAnimation();
      }
    };
  }, [dots]);

  return (
    <View
      accessibilityLabel="The other person is typing"
      accessibilityRole="text"
      style={[styles.root, { paddingLeft: 20 }]}
    >
      {dots.map((value, index) => (
        <Animated.View
          key={index}
          style={[
            styles.dot,
            {
              backgroundColor: theme.dividerText,
              opacity: value.interpolate({
                inputRange: [0, 1],
                outputRange: [0.35, 1],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    borderRadius: 9999,
    height: 6,
    width: 6,
  },
  root: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    paddingBottom: 6,
  },
});
