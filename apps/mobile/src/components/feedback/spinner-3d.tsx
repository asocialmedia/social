// Native port of apps/web's Spinner3D
// (components/layouts/feedback/spinner-3d.tsx).
//
// A bespoke 3D spinner with a solid material: a single self-colored raised ring
// (bright top lip, darker outer hairline) with an orange arc sweeping around
// it. No gradients on the base and no glow bloom - the depth comes from the
// layered strokes, not from a shadow, so it reads as one physical object.
//
// The web version builds the ring from a CSS conic-gradient plus a radial mask.
// React Native has neither, so the same material is composed from SVG strokes:
// the arc is a stroked circle with a gradient and rounded caps, rotated by
// Reanimated. The 1.1s linear sweep matches the web exactly.

import { useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import {
  createAnimatedComponent,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";

import { useAppTheme } from "@/theme";

interface Spinner3DProps {
  className?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

// Matches the web track (#3a3f4a) in dark mode. Light mode needs a mid tone so
// the ring stays visible against the pale card without turning into a hairline.
const TRACK_DARK = "#3a3f4a";
const TRACK_LIGHT = "#c9ced8";

const SWEEP_MS = 1100;

// Share of the ring the arc covers. The web's conic gradient fades in over the
// first ~20% and out over the last ~20% of a ~80% sweep.
const ARC_FRACTION = 0.8;

const AnimatedView = createAnimatedComponent(View);

export function Spinner3D({ className, size = 56, style }: Spinner3DProps) {
  const { isDark } = useAppTheme();
  const reduceMotion = useReducedMotion();

  const rotation = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    // oxlint-disable-next-line react/immutability -- assigning a Reanimated shared value is how an animation is started; the same pattern is used by the login screen's shake
    rotation.value = withRepeat(
      withTiming(360, { duration: SWEEP_MS, easing: Easing.linear }),
      -1,
      false
    );
  }, [reduceMotion, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  // Ring geometry: the stroke sits inside the box so the outer edge lands on
  // `size`, matching the web's side-14 (56px) box.
  const stroke = Math.max(2, size * 0.11);
  const radius = (size - stroke) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  const trackColor = isDark ? TRACK_DARK : TRACK_LIGHT;

  return (
    <View
      accessibilityLabel="Loading"
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      className={className}
      style={[{ height: size, width: size }, style]}
    >
      {/* Static material: outer hairline, track, and the top lip that catches
          light. Drawn as separate circles so each edge reads on its own. */}
      <Svg height={size} width={size}>
        <Circle
          cx={center}
          cy={center}
          fill="none"
          r={radius}
          stroke={isDark ? "rgba(0, 0, 0, 0.6)" : "rgba(0, 0, 0, 0.14)"}
          strokeWidth={1}
        />
        <Circle
          cx={center}
          cy={center}
          fill="none"
          r={radius - 0.5}
          stroke={trackColor}
          strokeWidth={stroke}
        />
        {/* Top lip: a short arc at 12 o'clock, the highlight that gives the
            ring its raised feel. */}
        <Circle
          cx={center}
          cy={center}
          fill="none"
          origin={`${center}, ${center}`}
          r={radius - 0.5}
          rotation={-90}
          stroke={
            isDark ? "rgba(255, 255, 255, 0.20)" : "rgba(255, 255, 255, 0.85)"
          }
          strokeDasharray={`${circumference * 0.28} ${circumference * 0.72}`}
          strokeLinecap="round"
          strokeWidth={stroke * 0.32}
        />
      </Svg>

      {/* Sweeping arc, on its own rotating layer. */}
      <AnimatedView
        pointerEvents="none"
        style={[
          { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
          animatedStyle,
        ]}
      >
        <Svg height={size} width={size}>
          <Defs>
            <LinearGradient id="asmSpinnerArc" x1="0" x2="1" y1="0" y2="1">
              <Stop offset="0" stopColor="#ff9500" stopOpacity="0" />
              <Stop offset="0.2" stopColor="#ff9500" stopOpacity="1" />
              <Stop offset="0.8" stopColor="#e65500" stopOpacity="1" />
              <Stop offset="1" stopColor="#e65500" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Circle
            cx={center}
            cy={center}
            fill="none"
            r={radius - 0.5}
            stroke="url(#asmSpinnerArc)"
            strokeDasharray={`${circumference * ARC_FRACTION} ${
              circumference * (1 - ARC_FRACTION)
            }`}
            strokeLinecap="round"
            strokeWidth={stroke}
          />
        </Svg>
      </AnimatedView>
    </View>
  );
}

export default Spinner3D;
