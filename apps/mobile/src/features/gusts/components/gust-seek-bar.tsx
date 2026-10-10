import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { seekRatio } from "../lib/seek-position";

function scrubTimestamp() {
  "worklet";
  return Date.now();
}

export function SeekBar({
  duration,
  onSeek,
  progress,
}: {
  duration: number;
  onSeek: (seconds: number) => void;
  progress: number;
}) {
  const insets = useSafeAreaInsets();
  const width = useSharedValue(0);
  const dragging = useSharedValue(false);
  const position = useSharedValue(0);
  const seekTick = useSharedValue(0);
  // oxlint-disable-next-line react/capitalized-calls -- Gesture.Pan is the gesture-handler builder, not a React component
  const pan = Gesture.Pan()
    .enabled(duration > 0)
    .minDistance(0)
    .onStart((event) => {
      dragging.set(true);
      position.set(seekRatio(event.x, width.get()));
      seekTick.set(Math.floor(scrubTimestamp() / 100));
      scheduleOnRN(onSeek, position.get() * duration);
    })
    .onUpdate((event) => {
      position.set(seekRatio(event.x, width.get()));
      seekTick.set(Math.floor(scrubTimestamp() / 100));
    })
    .onEnd(() => {
      scheduleOnRN(onSeek, position.get() * duration);
    })
    .onFinalize(() => {
      dragging.set(false);
    });
  useAnimatedReaction(
    () => ({ dragging: dragging.get(), tick: seekTick.get() }),
    (next, previous) => {
      // Cross the 100ms boundary on the UI thread, then issue one decoder seek.
      if (previous?.dragging && next.dragging && next.tick !== previous.tick) {
        scheduleOnRN(onSeek, position.get() * duration);
      }
    }
  );
  const thickness = useAnimatedStyle(() => ({
    transform: [
      { scaleY: withTiming(dragging.get() ? 3 : 1, { duration: 120 }) },
    ],
  }));
  const fill = useAnimatedStyle(() => ({
    transform: [
      { scaleX: dragging.get() ? position.get() : seekRatio(progress, 1) },
    ],
  }));
  const thumb = useAnimatedStyle(() => ({
    opacity: dragging.get() ? 1 : 0,
    transform: [{ translateX: position.get() * width.get() - 5 }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessibilityActions={[
          { label: "Forward five seconds", name: "increment" },
          { label: "Back five seconds", name: "decrement" },
        ]}
        accessibilityLabel="Seek video"
        accessibilityRole="adjustable"
        accessibilityValue={{
          max: Math.round(duration),
          min: 0,
          now: Math.round(seekRatio(progress, 1) * duration),
        }}
        onAccessibilityAction={(event) =>
          onSeek(
            Math.min(
              duration,
              Math.max(
                0,
                progress * duration +
                  (event.nativeEvent.actionName === "increment" ? 5 : -5)
              )
            )
          )
        }
        onLayout={(event) => width.set(event.nativeEvent.layout.width)}
        style={[styles.hit, { bottom: Math.max(insets.bottom, 8) }]}
      >
        <Animated.View pointerEvents="none" style={[styles.track, thickness]}>
          <Animated.View style={[styles.fill, fill]}>
            <LinearGradient
              colors={["#ff9500", "#e65500"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.thumb, thumb]} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: {
    backgroundColor: "#ff9500",
    borderRadius: 9999,
    height: 2,
    transformOrigin: "left",
  },
  hit: {
    height: 44,
    justifyContent: "center",
    left: 12,
    position: "absolute",
    right: 12,
    zIndex: 30,
  },
  thumb: {
    backgroundColor: "#ff9500",
    borderColor: "#b95404",
    borderRadius: 5,
    borderWidth: 1,
    boxShadow:
      "inset 0 1px 1px rgba(255,255,255,0.8), 0 1px 2px rgba(0,0,0,0.4)",
    height: 10,
    left: 0,
    position: "absolute",
    top: 17,
    width: 10,
  },
  track: {
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: 9999,
    height: 2,
    overflow: "hidden",
  },
});
