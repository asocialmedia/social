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
import { followButtonTone } from "@/features/profile/lib/follow-button-tone";
import { useAppTheme } from "@/theme";

function PulseDot({ color, delay }: { color: string; delay: number }) {
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
  return (
    <Animated.View style={[styles.dot, { backgroundColor: color, opacity }]} />
  );
}

// The label rises in on every flip: keyed by text so a change remounts
// and replays the entrance, with no trigger-only effect dependency to keep
// in sync (exhaustive-deps flags those either way).
function CrossfadeLabel({ color, text }: { color: string; text: string }) {
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
      numberOfLines={1}
      style={[
        styles.label,
        {
          color,
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
  // Web's gust follow button is the shared follow button: orange to follow,
  // neutral gray once following.
  const tone = followButtonTone(isDark, following);
  return (
    <Pressable
      accessibilityLabel={following ? "Unfollow" : "Follow"}
      accessibilityRole="button"
      accessibilityState={{ busy: pending }}
      disabled={pending}
      hitSlop={6}
      onPress={onPress}
      style={styles.trigger}
    >
      {({ pressed }) => (
        <Gradient3D
          colors={tone.colors}
          shadows={tone.shadows}
          style={[styles.pill, pressed && styles.pressed]}
        >
          {pending ? (
            <View style={styles.dots}>
              <PulseDot color={tone.textColor} delay={0} />
              <PulseDot color={tone.textColor} delay={150} />
              <PulseDot color={tone.textColor} delay={300} />
            </View>
          ) : (
            <CrossfadeLabel color={tone.textColor} key={label} text={label} />
          )}
          {/* Keeps the pill width steady while the dots show. */}
          <Text numberOfLines={1} style={[styles.label, styles.ghost]}>
            Following
          </Text>
        </Gradient3D>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dot: {
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
    fontFamily: "SofiaProBold",
    fontSize: 12,
    fontWeight: "normal",
    position: "absolute",
    textAlign: "center",
  },
  pill: {
    minHeight: 28,
    minWidth: 88,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
  trigger: { flexShrink: 0 },
});
