// Loading placeholder for the HackerNews feed, mirroring web's
// `components/hackernews/hn-feed-skeleton.tsx`: the Y badge and its label, the
// time and save controls, the title with its domain pill, the three metadata
// pills, then the row actions. Three of them stand in for the first screenful,
// split by the same dividers the real rows use.
//
// `HnFeedSkeletonCard` is the pagination footer, matching web's LoadMoreSkeleton
// so the last page's arrival does not change the shape of the list.
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { useSkeletonPulse } from "@/components/feedback/use-skeleton-pulse";
import { useAppTheme } from "@/theme";

function SkeletonRow() {
  const { theme } = useAppTheme();
  const pulse = useSkeletonPulse();

  const block = { backgroundColor: theme.dividerLine };
  return (
    <Animated.View style={[styles.row, { opacity: pulse }]}>
      <View style={styles.top}>
        <View style={styles.brand}>
          <View style={[styles.logo, block]} />
          <View style={[styles.brandLine, block]} />
        </View>
        <View style={styles.topRight}>
          <View style={[styles.timeLine, block]} />
          <View style={[styles.save, block]} />
        </View>
      </View>

      <View style={styles.titleRow}>
        <View style={[styles.titleLine, block]} />
        <View style={[styles.domain, block]} />
      </View>

      <View style={styles.chips}>
        <View style={[styles.chipWide, block]} />
        <View style={[styles.chipNarrow, block]} />
        <View style={[styles.chipWidest, block]} />
      </View>

      <View style={styles.actions}>
        <View style={[styles.actionWide, block]} />
        <View style={[styles.actionNarrow, block]} />
        <View style={[styles.actionEnd, block]} />
      </View>
    </Animated.View>
  );
}

export function HnFeedSkeleton() {
  const { theme } = useAppTheme();
  return (
    <View>
      {[0, 1, 2].map((index) => (
        <View
          key={index}
          style={[styles.separator, { borderBottomColor: theme.cardBorder }]}
        >
          <SkeletonRow />
        </View>
      ))}
    </View>
  );
}

/** Web's LoadMoreSkeleton body, one story-shaped placeholder. */
export function HnFeedSkeletonCard() {
  return <SkeletonRow />;
}

const styles = StyleSheet.create({
  actionEnd: { borderRadius: 8, height: 24, marginLeft: "auto", width: 56 },
  actionNarrow: { borderRadius: 8, height: 24, width: 48 },
  actionWide: { borderRadius: 8, height: 24, width: 64 },
  actions: {
    flexDirection: "row",
    gap: 6,
    marginTop: 2,
    paddingTop: 8,
  },
  brand: { alignItems: "center", flexDirection: "row", gap: 8 },
  brandLine: { borderRadius: 4, height: 12, width: 80 },
  chipNarrow: { borderRadius: 9999, height: 20, width: 64 },
  chipWide: { borderRadius: 9999, height: 20, width: 80 },
  chipWidest: { borderRadius: 9999, height: 20, width: 96 },
  chips: { flexDirection: "row", gap: 6, marginTop: 2 },
  domain: { borderRadius: 9999, height: 16, marginTop: 2, width: 64 },
  logo: { borderRadius: 6, height: 20, width: 20 },
  row: { gap: 6, padding: 12 },
  save: { borderRadius: 9999, height: 24, width: 24 },
  separator: { borderBottomWidth: 1 },
  timeLine: { borderRadius: 4, height: 12, width: 64 },
  titleLine: { borderRadius: 4, flex: 1, height: 16 },
  titleRow: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  top: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  topRight: { alignItems: "center", flexDirection: "row", gap: 8 },
});
