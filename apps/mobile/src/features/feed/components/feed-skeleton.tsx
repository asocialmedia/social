import {
  fitPreviewFrame,
  postPreviewLayout,
} from "@asm/ui/lib/post-preview-layout";
import type { PostPreviewSource } from "@asm/ui/lib/post-preview-layout";
import { useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated from "react-native-reanimated";

import { useSkeletonPulse } from "@/components/feedback/use-skeleton-pulse";
import { useAppTheme } from "@/theme";

export function PostSkeletonMedia({
  post,
}: {
  post?: PostPreviewSource | null;
}) {
  const { theme } = useAppTheme();
  const viewport = useWindowDimensions();
  const [width, setWidth] = useState(viewport.width - 80);
  const layout = postPreviewLayout(post);
  const block = { backgroundColor: theme.dividerLine };
  if (layout.kind === "text" || layout.kind === "unknown") {
    return null;
  }
  if (layout.kind === "album") {
    return (
      <View style={styles.album}>
        {Array.from({ length: Math.min(layout.count, 5) }, (_, index) => (
          <View key={index} style={[styles.albumTile, block]} />
        ))}
      </View>
    );
  }
  if (layout.kind === "audio") {
    return <View style={[styles.audio, block]} />;
  }
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={styles.media}
    >
      <View
        style={[
          block,
          styles.frame,
          fitPreviewFrame(width, layout.aspectRatio),
        ]}
      />
    </View>
  );
}

export function FeedSkeletonCard({
  post,
  detail = false,
}: {
  detail?: boolean;
  post?: PostPreviewSource | null;
}) {
  const { theme } = useAppTheme();
  const pulse = useSkeletonPulse();
  const block = { backgroundColor: theme.dividerLine };
  const layout = postPreviewLayout(post);
  return (
    <Animated.View
      accessibilityLabel="Loading post"
      style={[styles.card, { opacity: pulse }]}
    >
      <View style={styles.row}>
        <View style={[styles.avatar, block]} />
        <View style={styles.body}>
          <View style={styles.headerRow}>
            <View style={[styles.line, styles.name, block]} />
            <View style={[styles.line, styles.handle, block]} />
          </View>
          {detail ? <View style={[styles.line, styles.handle, block]} /> : null}
        </View>
      </View>
      <View style={[styles.content, !detail && styles.feedContent]}>
        {Array.from({ length: layout.textLines }, (_, index) => (
          <View
            key={index}
            style={[
              styles.line,
              block,
              index === layout.textLines - 1
                ? styles.textPartial
                : styles.textFull,
            ]}
          />
        ))}
        <PostSkeletonMedia post={post} />
        <View style={styles.actions}>
          {[0, 1, 2, 3, 4].map((index) => (
            <View key={index} style={[styles.pill, block]} />
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

export function FeedSkeleton({
  posts,
}: { posts?: readonly PostPreviewSource[] } = {}) {
  const { theme } = useAppTheme();
  return (
    <View>
      {(posts?.length ? posts : [undefined, undefined, undefined]).map(
        (post, index) => (
          <View
            key={index}
            style={{
              borderBottomColor: theme.cardBorder,
              borderBottomWidth: 1,
            }}
          >
            <FeedSkeletonCard post={post} />
          </View>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    marginTop: 14,
  },
  album: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  albumTile: { borderRadius: 12, height: 130, width: "48%" },
  audio: { borderRadius: 16, height: 76, marginTop: 12, width: "100%" },
  avatar: { borderRadius: 12, height: 36, width: 36 },
  body: { flex: 1, minWidth: 0 },
  card: { padding: 16 },
  content: { marginTop: 8 },
  feedContent: { marginLeft: 48 },
  frame: { alignSelf: "flex-start", borderRadius: 12 },
  handle: { maxWidth: "30%", width: 72 },
  headerRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  line: { borderRadius: 4, height: 14, marginTop: 6 },
  media: { marginTop: 12, width: "100%" },
  name: { maxWidth: "50%", width: 112 },
  pill: { borderRadius: 999, height: 28, width: "15%" },
  row: { flexDirection: "row", gap: 12 },
  textFull: { width: "100%" },
  textPartial: { width: "75%" },
});
