import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// Web's msg-jump-shimmer: one 800 ms slanted white sweep, clipped by the bubble.
export function MessageSearchHighlight({ jump }: { jump: number }) {
  const reducedMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);
  useEffect(() => {
    if (!jump || !width || reducedMotion) {
      return;
    }
    progress.set(0);
    progress.set(
      withTiming(1, { duration: 800, easing: Easing.out(Easing.quad) })
    );
  }, [jump, progress, reducedMotion, width]);
  const bandStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: width * (-1 + 1.5 * progress.get()) },
      { skewX: "-20deg" },
    ],
  }));
  if (!jump || reducedMotion) {
    return null;
  }
  return (
    <Animated.View
      className="absolute inset-0 overflow-hidden"
      pointerEvents="none"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <Animated.View
        style={[
          {
            bottom: "-25%",
            left: "50%",
            position: "absolute",
            top: "-25%",
            width: "50%",
          },
          bandStyle,
        ]}
      >
        <LinearGradient
          colors={["#ffffff00", "#ffffff99", "#ffffff00"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </Animated.View>
  );
}
