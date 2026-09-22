// Loading skeleton for the feed: three post-shaped placeholders with a
// gentle opacity pulse (core Animated loop, no extra dependency), matching
// web FeedViewSkeleton's structure (avatar + header lines + text lines +
// media block + action row).
import { useEffect, useMemo } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { useAppTheme } from "@/theme";

function SkeletonCard() {
  const { theme } = useAppTheme();
  const pulse = useMemo(() => new Animated.Value(0.45), []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 900,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 900,
          toValue: 0.45,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [pulse]);

  const block = { backgroundColor: theme.dividerLine };
  return (
    <Animated.View style={[styles.card, { opacity: pulse }]}>
      <View style={styles.row}>
        <View style={[styles.avatar, block]} />
        <View style={styles.body}>
          <View style={styles.headerRow}>
            <View style={[styles.line, block, styles.name]} />
            <View style={[styles.line, block, styles.handle]} />
          </View>
          <View style={[styles.line, block, styles.textFull]} />
          <View style={[styles.line, block, styles.textPartial]} />
          <View style={[styles.media, block]} />
          <View style={styles.actions}>
            <View style={[styles.pill, block]} />
            <View style={[styles.pill, block]} />
            <View style={[styles.pill, block]} />
            <View style={[styles.pill, block]} />
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

export function FeedSkeleton() {
  const { theme } = useAppTheme();
  return (
    <View style={styles.list}>
      {[0, 1, 2].map((index) => (
        <View
          key={index}
          style={[styles.separator, { borderBottomColor: theme.cardBorder }]}
        >
          <SkeletonCard />
        </View>
      ))}
    </View>
  );
}

// Single post-shaped placeholder for the pagination footer: web's
// LoadMoreSkeleton renders two of these while the next page loads.
export function FeedSkeletonCard() {
  return <SkeletonCard />;
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  avatar: {
    borderRadius: 12,
    height: 40,
    width: 40,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  card: {
    padding: 16,
  },
  handle: {
    width: 80,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  line: {
    borderRadius: 4,
    height: 14,
    marginTop: 8,
  },
  list: {
    flex: 1,
  },
  media: {
    borderRadius: 8,
    height: 180,
    marginTop: 12,
  },
  name: {
    width: 110,
  },
  pill: {
    borderRadius: 9999,
    height: 28,
    width: 64,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  separator: {
    borderBottomWidth: 1,
  },
  textFull: {
    width: "100%",
  },
  textPartial: {
    width: "75%",
  },
});
