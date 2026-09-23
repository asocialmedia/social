// Web's GustCardSkeleton at phone size: a black/50 frame over a white/5
// fill, the bottom scrim, the info block (40px squircle avatar, name and
// handle bars, the follow pill, two caption bars, the views row), the
// seven-circle rail with the aura and eddie count bars, and the seek line.
// Bars use the Skeleton base (primary/10, pulsing).
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import type { DimensionValue } from "react-native";

function Bar({
  height,
  radius = 6,
  width,
}: {
  height: number;
  radius?: number;
  width: DimensionValue;
}) {
  return <View style={[styles.bar, { borderRadius: radius, height, width }]} />;
}

export function GustCardSkeleton() {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 1000,
          easing: Easing.bezier(0.4, 0, 0.6, 1),
          toValue: 0.5,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 1000,
          easing: Easing.bezier(0.4, 0, 0.6, 1),
          toValue: 1,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View
      accessibilityLabel="Loading gusts"
      accessibilityRole="progressbar"
      style={styles.frame}
    >
      <View style={styles.fill} />
      <LinearGradient
        colors={["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0.7)"]}
        end={{ x: 0.5, y: 1 }}
        start={{ x: 0.5, y: 0 }}
        style={styles.scrim}
      />
      <Animated.View style={[styles.info, { opacity: pulse }]}>
        <View style={styles.authorRow}>
          <Bar height={40} radius={12} width={40} />
          <View style={styles.nameCol}>
            <Bar height={14} width={96} />
            <Bar height={12} width={64} />
          </View>
          <Bar height={32} radius={9999} width={80} />
        </View>
        <View style={styles.captionCol}>
          <Bar height={12} width="75%" />
          <Bar height={12} width="50%" />
        </View>
        <View style={styles.viewsRow}>
          <Bar height={16} radius={9999} width={16} />
          <Bar height={12} width={56} />
        </View>
      </Animated.View>
      <Animated.View style={[styles.rail, { opacity: pulse }]}>
        {[0, 1, 2, 3, 4, 5, 6].map((index) => (
          <View key={index} style={styles.railItem}>
            <View style={styles.railCircle} />
            {index === 0 ? <Bar height={16} width={40} /> : null}
            {index === 2 ? <Bar height={12} width={20} /> : null}
          </View>
        ))}
      </Animated.View>
      <View style={styles.seek}>
        <View style={styles.seekTrack} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  authorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  bar: {
    backgroundColor: "rgba(246, 107, 21, 0.1)",
  },
  captionCol: {
    gap: 6,
  },
  fill: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  frame: {
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    flex: 1,
    overflow: "hidden",
  },
  info: {
    bottom: 0,
    gap: 12,
    left: 0,
    paddingBottom: 32,
    paddingHorizontal: 16,
    paddingRight: 96,
    position: "absolute",
    right: 0,
  },
  nameCol: {
    gap: 6,
  },
  rail: {
    alignItems: "center",
    bottom: 96,
    gap: 16,
    position: "absolute",
    right: 12,
  },
  railCircle: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 9999,
    height: 44,
    width: 44,
  },
  railItem: {
    alignItems: "center",
    gap: 6,
  },
  scrim: {
    bottom: 0,
    height: 224,
    left: 0,
    position: "absolute",
    right: 0,
  },
  seek: {
    bottom: 0,
    left: 0,
    paddingBottom: 4,
    paddingHorizontal: 4,
    position: "absolute",
    right: 0,
  },
  seekTrack: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 9999,
    height: 4,
  },
  viewsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
});
