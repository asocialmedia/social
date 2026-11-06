import { BUBBLE_MOTION } from "@asm/messages";
import type { ReactNode } from "react";
import { useEffect } from "react";
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

// oxlint-disable react/immutability -- Shared values are UI-thread animation handles.
export function MessageBubbleEntrance({
  children,
  mine,
  media = false,
}: {
  children: ReactNode;
  mine: boolean;
  media?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(reducedMotion ? 1 : 0);
  const opacity = useSharedValue(reducedMotion ? 1 : 0.3);
  useEffect(() => {
    const motion = BUBBLE_MOTION[mine ? "outgoing" : "incoming"];
    progress.value = withSpring(1, {
      damping: motion.damping,
      energyThreshold: 1e-6,
      mass: motion.mass,
      reduceMotion: ReduceMotion.System,
      stiffness: motion.stiffness,
    });
    opacity.value = withTiming(1, {
      duration: 130,
      reduceMotion: ReduceMotion.System,
    });
    return () => {
      cancelAnimation(progress);
      cancelAnimation(opacity);
    };
  }, [mine, opacity, progress]);
  const motionStyle = useAnimatedStyle(() => {
    const motion = BUBBLE_MOTION[mine ? "outgoing" : "incoming"];
    return {
      opacity: opacity.value,
      transform: [
        { translateX: (1 - progress.value) * motion.x },
        { translateY: (1 - progress.value) * motion.y },
      ],
    };
  });
  const materialStyle = useAnimatedStyle(() => {
    const motion = BUBBLE_MOTION[mine ? "outgoing" : "incoming"];
    return {
      transform: [
        {
          scaleX:
            1 - (1 - progress.value) * (1 - (media ? 0.96 : motion.scaleX)),
        },
        {
          scaleY:
            1 - (1 - progress.value) * (1 - (media ? 0.94 : motion.scaleY)),
        },
      ],
    };
  });
  return (
    <Animated.View style={motionStyle}>
      <Animated.View
        style={[
          { transformOrigin: mine ? "bottom right" : "bottom left" },
          materialStyle,
        ]}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}
