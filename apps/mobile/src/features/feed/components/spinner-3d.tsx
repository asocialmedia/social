// Native port of web's Spinner3D (layouts/feedback/spinner-3d): a solid
// 3D track ring with a bright top lip, and an orange arc sweeping around
// it on a 1.1s linear loop. The conic gradient becomes an SVG arc with a
// linear orange gradient; the rotation runs on the native driver.
import { useEffect, useId, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import {
  Circle,
  Defs,
  LinearGradient as SvgGradient,
  Stop,
  Svg,
} from "react-native-svg";

const SIZE = 56;
const CENTER = SIZE / 2;
const RADIUS = 24;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Web's conic arc spans roughly 72deg -> 300deg (~63% of the ring).
const ARC_LENGTH = CIRCUMFERENCE * 0.63;

export function Spinner3D({ size = SIZE }: { size?: number }) {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [spin] = useState(() => new Animated.Value(0));
  const gradientId = useId().replaceAll(":", "");

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        duration: 1100,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => {
      loop.stop();
      spin.setValue(0);
    };
  }, [spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      style={[styles.box, { height: size, width: size }]}
    >
      <Animated.View
        style={{ transform: [{ rotate }, { scale: size / SIZE }] }}
      >
        <Svg height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE}>
          <Defs>
            <SvgGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#ff9500" />
              <Stop offset="1" stopColor="#e65500" />
            </SvgGradient>
          </Defs>
          <Circle
            cx={CENTER}
            cy={CENTER}
            fill="none"
            r={RADIUS}
            stroke="#3a3f4a"
            strokeWidth={7}
          />
          <Circle
            cx={CENTER}
            cy={CENTER}
            fill="none"
            r={RADIUS - 3.5}
            stroke="rgba(255, 255, 255, 0.18)"
            strokeWidth={1}
          />
          <Circle
            cx={CENTER}
            cy={CENTER}
            fill="none"
            r={RADIUS}
            stroke={`url(#${gradientId})`}
            strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE - ARC_LENGTH}`}
            strokeLinecap="round"
            strokeWidth={7}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    justifyContent: "center",
  },
});
