// Native port of apps/web's Spinner3D
// (components/layouts/feedback/spinner-3d.tsx).
//
// A solid 3D ring: a #3a3f4a track masked to the outer ~23% of a 56px disc
// (radial mask, transparent to 76-78%), lit by its inset shadows - a 1px
// white hairline on the outer edge, a bright top lip and a dark bottom
// recess - with an orange conic arc sweeping over it on a 1.1s linear loop.
//
// The arc is web's conic-gradient(transparent 0-72deg, #ff9500 at 140deg,
// #e65500 at 300deg, transparent at 360deg): a comet that fades in, runs
// solid, and fades out. SVG has no conic gradient, so the arc is drawn as
// thin annular slices, each filled with the conic color at its angle. The
// geometry is authored on web's 56px box and scaled to `size`.

import { useEffect, useId } from "react";
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
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Stop,
} from "react-native-svg";

import { buildConicArc } from "./spinner-arc";

interface Spinner3DProps {
  className?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

const BOX = 56;
const CENTER = BOX / 2;
const OUTER_RADIUS = 28;
// Mask edge: transparent to 76%, opaque from 78% of the closest side.
const INNER_RADIUS = OUTER_RADIUS * 0.77;
const SWEEP_MS = 1100;

// Built once: the slices never change, only the layer rotates.
const ARC_SLICES = buildConicArc({
  center: CENTER,
  innerRadius: INNER_RADIUS,
  outerRadius: OUTER_RADIUS,
});

// Even-odd annulus for the track.
const TRACK_PATH = [
  `M ${CENTER - OUTER_RADIUS} ${CENTER}`,
  `a ${OUTER_RADIUS} ${OUTER_RADIUS} 0 1 0 ${OUTER_RADIUS * 2} 0`,
  `a ${OUTER_RADIUS} ${OUTER_RADIUS} 0 1 0 ${-OUTER_RADIUS * 2} 0`,
  `M ${CENTER - INNER_RADIUS} ${CENTER}`,
  `a ${INNER_RADIUS} ${INNER_RADIUS} 0 1 0 ${INNER_RADIUS * 2} 0`,
  `a ${INNER_RADIUS} ${INNER_RADIUS} 0 1 0 ${-INNER_RADIUS * 2} 0`,
  "Z",
].join(" ");

const AnimatedView = createAnimatedComponent(View);

export function Spinner3D({ className, size = BOX, style }: Spinner3DProps) {
  const reduceMotion = useReducedMotion();
  const gradientId = useId().replaceAll(":", "");

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

  const lipId = `${gradientId}lip`;
  const recessId = `${gradientId}recess`;

  return (
    <View
      accessibilityLabel="Loading"
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      className={className}
      style={[{ height: size, width: size }, style]}
    >
      {/* Solid track with its inset lighting, clipped to the ring. */}
      <Svg height={size} viewBox={`0 0 ${BOX} ${BOX}`} width={size}>
        <Defs>
          {/* inset 0 1.5px 2px rgba(255,255,255,0.28): the top lip. */}
          <LinearGradient id={lipId} x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
            <Stop offset="0.28" stopColor="#ffffff" stopOpacity="0" />
            <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </LinearGradient>
          {/* inset 0 -2px 4px rgba(0,0,0,0.4): the bottom recess. */}
          <LinearGradient id={recessId} x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor="#000000" stopOpacity="0" />
            <Stop offset="0.62" stopColor="#000000" stopOpacity="0" />
            <Stop offset="1" stopColor="#000000" stopOpacity="0.4" />
          </LinearGradient>
        </Defs>
        <Path d={TRACK_PATH} fill="#3a3f4a" fillRule="evenodd" />
        <Circle
          cx={CENTER}
          cy={CENTER}
          fill="none"
          r={OUTER_RADIUS - 1.25}
          stroke={`url(#${lipId})`}
          strokeWidth={2.5}
        />
        <Circle
          cx={CENTER}
          cy={CENTER}
          fill="none"
          r={OUTER_RADIUS - 1.5}
          stroke={`url(#${recessId})`}
          strokeWidth={3}
        />
        {/* inset 0 0 0 1px rgba(255,255,255,0.18): the outer hairline. */}
        <Circle
          cx={CENTER}
          cy={CENTER}
          fill="none"
          r={OUTER_RADIUS - 0.5}
          stroke="rgba(255, 255, 255, 0.18)"
          strokeWidth={1}
        />
      </Svg>

      {/* The conic arc on its own rotating layer. */}
      <AnimatedView
        pointerEvents="none"
        style={[
          { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
          animatedStyle,
        ]}
      >
        <Svg height={size} viewBox={`0 0 ${BOX} ${BOX}`} width={size}>
          {ARC_SLICES.map((slice) => (
            <Path
              d={slice.path}
              fill={slice.color}
              fillOpacity={slice.opacity}
              key={slice.key}
            />
          ))}
        </Svg>
      </AnimatedView>
    </View>
  );
}

export default Spinner3D;
