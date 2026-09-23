// Web's gust FollowButton: `follow-btn-3d` on an h-7 rounded-full pill with
// text-xs semibold, the label crossfading (y +-5, 0.2s) between Follow and
// Following, and three pulsing dots while the request is in flight.
import { useEffect, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import { followButtonShadows } from "@/components/surface/recipes";
import { useAppTheme } from "@/theme";

function PulseDot({ delay }: { delay: number }) {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [opacity] = useState(() => new Animated.Value(0.3));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, {
          duration: 300,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          duration: 300,
          toValue: 0.3,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delay, opacity]);
  return <Animated.View style={[styles.dot, { opacity }]} />;
}

// The label rises in on every flip: keyed by text so a change remounts
// and replays the entrance, with no trigger-only effect dependency to keep
// in sync (exhaustive-deps flags those either way).
function CrossfadeLabel({ text }: { text: string }) {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [rise] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const crossfade = Animated.timing(rise, {
      duration: 200,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    crossfade.start();
    return () => crossfade.stop();
  }, [rise]);
  return (
    <Animated.Text
      style={[
        styles.label,
        {
          opacity: rise,
          transform: [
            {
              translateY: rise.interpolate({
                inputRange: [0, 1],
                outputRange: [5, 0],
              }),
            },
          ],
        },
      ]}
    >
      {text}
    </Animated.Text>
  );
}

export function FollowButton({
  following,
  onPress,
  pending,
}: {
  following: boolean;
  onPress: () => void;
  pending: boolean;
}) {
  const { isDark } = useAppTheme();
  const label = following ? "Following" : "Follow";
  return (
    <Pressable
      accessibilityLabel={following ? "Unfollow" : "Follow"}
      accessibilityRole="button"
      accessibilityState={{ busy: pending }}
      disabled={pending}
      hitSlop={6}
      onPress={onPress}
    >
      {({ pressed }) => (
        <Gradient3D
          colors={["#ff9500", "#e65500"]}
          shadows={followButtonShadows(isDark)}
          style={[styles.pill, pressed && styles.pressed]}
        >
          {pending ? (
            <View style={styles.dots}>
              <PulseDot delay={0} />
              <PulseDot delay={150} />
              <PulseDot delay={300} />
            </View>
          ) : (
            <CrossfadeLabel key={label} text={label} />
          )}
          {/* Keeps the pill width steady while the dots show. */}
          <Text style={[styles.label, styles.ghost]}>{label}</Text>
        </Gradient3D>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dot: {
    backgroundColor: "#ffffff",
    borderRadius: 9999,
    height: 4,
    width: 4,
  },
  dots: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
    position: "absolute",
  },
  ghost: {
    opacity: 0,
    position: "relative",
  },
  label: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 12,
    fontWeight: "normal",
    position: "absolute",
  },
  pill: {
    height: 28,
    paddingHorizontal: 12,
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
});
