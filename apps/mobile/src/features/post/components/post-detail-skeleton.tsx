import type { PostPreviewSource } from "@asm/ui/lib/post-preview-layout";
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { useSkeletonPulse } from "@/components/feedback/use-skeleton-pulse";
import { FeedSkeletonCard } from "@/features/feed/components/feed-skeleton";
import { useAppTheme } from "@/theme";

export function PostDetailSkeleton({
  post,
}: { post?: PostPreviewSource | null } = {}) {
  const { theme } = useAppTheme();
  const pulse = useSkeletonPulse();
  const block = { backgroundColor: theme.dividerLine };
  return (
    <View style={styles.root}>
      <Animated.View style={[styles.header, { opacity: pulse }]}>
        <View style={[styles.back, block]} />
        <View style={[styles.title, block]} />
      </Animated.View>
      <FeedSkeletonCard detail post={post} />
      <Animated.View style={[styles.more, { opacity: pulse }]}>
        <View style={[styles.heading, block]} />
        <View style={[styles.title, block]} />
      </Animated.View>
      <FeedSkeletonCard />
      <FeedSkeletonCard />
    </View>
  );
}

const styles = StyleSheet.create({
  back: { borderRadius: 999, height: 36, width: 36 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  heading: { borderRadius: 6, height: 16, width: 144 },
  more: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
  },
  root: { flex: 1 },
  title: { borderRadius: 6, height: 16, width: 64 },
});
