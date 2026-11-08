// Home-feed loading skeleton: a 1:1 native port of web's mobile
// post-card-skeleton (layouts/skeletons/post-card-skeleton.tsx). Same block
// shapes and sizes: 36px squircle avatar, name/badge/handle/date header with
// the more icon, web's text-line widths, media blocks with web's album
// heights and 320px-capped aspect frames, and the mobile action bar (vote,
// eddies, respond, [+amplify], share + bookmark). Cards rotate through the
// same 8 dynamic profiles, Bluesky rows alternate on the mixed feed, and the
// list renders 8 cards initially with 4 more while paginating. The pulse
// runs on the UI thread via useSkeletonPulse; every block is a flat view,
// no shadows stacked per bar.
import {
  fitPreviewFrame,
  postPreviewLayout,
} from "@asm/ui/lib/post-preview-layout";
import type { PostPreviewSource } from "@asm/ui/lib/post-preview-layout";
import { useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated from "react-native-reanimated";

import { useSkeletonPulse } from "@/components/feedback/use-skeleton-pulse";
import { useAppTheme } from "@/theme";

import type {
  DynamicSkeletonProfile,
  FeedSkeletonSource,
} from "../lib/feed-skeleton-layout";
import {
  FEED_INITIAL_SKELETON_COUNT,
  isBlueskySkeletonIndex,
  skeletonLineWidth,
  skeletonProfileForIndex,
} from "../lib/feed-skeleton-layout";
import { BlueskyIcon } from "./bluesky-icon";

function useBlock() {
  const { theme } = useAppTheme();
  return { backgroundColor: theme.dividerLine };
}

export function PostSkeletonMedia({
  post,
  profile,
}: {
  post?: PostPreviewSource | null;
  profile?: DynamicSkeletonProfile | null;
}) {
  const viewport = useWindowDimensions();
  const [width, setWidth] = useState(viewport.width - 32);
  const layout = postPreviewLayout(post);
  const block = useBlock();
  const effectiveKind = post ? layout.kind : (profile?.kind ?? layout.kind);
  if (effectiveKind === "text" || effectiveKind === "unknown") {
    return null;
  }
  if (effectiveKind === "album") {
    const count =
      profile?.albumCount ?? (layout.kind === "album" ? layout.count : 2);
    const isTwo = count <= 2;
    return (
      <View style={styles.album} testID="skeleton-media-album">
        {Array.from({ length: Math.min(count, 4) }, (_, index) => (
          <View
            key={index}
            style={[block, isTwo ? styles.albumTwo : styles.albumFour]}
          />
        ))}
      </View>
    );
  }
  if (effectiveKind === "audio") {
    return (
      <View style={styles.audioRow} testID="skeleton-media-audio">
        <View style={[block, styles.audioAvatar]} />
        <View style={styles.audioLines}>
          <View style={[block, styles.audioTitle]} />
          <View style={[block, styles.audioWave]} />
        </View>
      </View>
    );
  }
  // Web caps the frame at 320px tall on mobile (360px for vertical), the
  // width shrinking to maxHeight * ratio. Measure the column, then clamp.
  let ratio = profile?.aspectRatio ?? 16 / 9;
  if (effectiveKind === "vertical") {
    ratio = profile?.aspectRatio ?? 3 / 4;
  } else if (post) {
    ratio = layout.aspectRatio;
  }
  const maxHeight = effectiveKind === "vertical" ? 360 : 320;
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={styles.media}
      testID="skeleton-media-image"
    >
      <View
        style={[
          block,
          styles.frame,
          fitPreviewFrame(Math.min(width, maxHeight * ratio), ratio),
        ]}
      />
    </View>
  );
}

export interface FeedSkeletonCardProps {
  detail?: boolean;
  index?: number;
  isBluesky?: boolean;
  post?: PostPreviewSource | null;
  profile?: DynamicSkeletonProfile | null;
  source?: FeedSkeletonSource;
}

export function FeedSkeletonCard({
  detail = false,
  index = 0,
  isBluesky,
  post,
  profile,
  source = "all",
}: FeedSkeletonCardProps) {
  const { theme } = useAppTheme();
  const pulse = useSkeletonPulse();
  const block = useBlock();
  const layout = postPreviewLayout(post);
  const isBsky =
    isBluesky ?? (source === "bluesky" || Boolean(post && "external" in post));

  const effectiveProfile: DynamicSkeletonProfile | undefined =
    profile ?? (post ? undefined : skeletonProfileForIndex(index));

  let lineCount = 2;
  if (post && typeof post.content === "string") {
    lineCount = layout.textLines;
  } else if (effectiveProfile) {
    lineCount = effectiveProfile.textLines;
  } else {
    lineCount = index % 3 === 1 ? 3 : 2;
  }

  const effectiveKind = post
    ? layout.kind
    : (effectiveProfile?.kind ?? layout.kind);

  return (
    <Animated.View
      accessibilityLabel={isBsky ? "Loading Bluesky post" : "Loading post"}
      accessibilityRole="progressbar"
      style={[styles.card, { opacity: pulse }]}
      testID={isBsky ? "skeleton-bluesky-card" : "skeleton-post-card"}
    >
      {detail ? (
        <View style={styles.headerRow}>
          <View style={[block, styles.avatar]} />
          <View style={styles.headerCopy}>
            <View style={styles.nameRow}>
              <View style={[block, styles.detailName]} />
              {isBsky ? (
                <View style={styles.bskyIcon}>
                  <BlueskyIcon size={14} />
                </View>
              ) : (
                <View style={[block, styles.detailBadge]} />
              )}
              <View style={[block, styles.detailDate]} />
            </View>
            <View style={styles.subRow}>
              <View
                style={[
                  block,
                  isBsky ? styles.detailHandleBsky : styles.detailHandle,
                ]}
              />
            </View>
          </View>
          <View style={styles.moreWrap}>
            <View style={[block, styles.moreIcon]} />
          </View>
        </View>
      ) : (
        <View style={styles.headerRow}>
          <View style={[block, styles.avatar]} />
          <View style={styles.headerCopy}>
            <View style={styles.nameRow}>
              <View style={[block, styles.name]} />
              {isBsky ? (
                <View style={styles.bskyIcon}>
                  <BlueskyIcon size={14} />
                </View>
              ) : (
                <View style={[block, styles.badge]} />
              )}
              <View
                style={[block, isBsky ? styles.handleBsky : styles.handle]}
              />
              <Text style={[styles.dot, { color: theme.dividerText }]}>·</Text>
              <View style={[block, styles.date]} />
            </View>
          </View>
          <View style={styles.moreWrap}>
            <View style={[block, styles.moreIcon]} />
          </View>
        </View>
      )}
      <View style={[styles.content, detail && styles.contentDetail]}>
        {Array.from({ length: lineCount }, (_, lineIndex) => (
          <View
            key={lineIndex}
            style={[
              block,
              styles.textLine,
              { width: `${skeletonLineWidth(lineIndex, lineCount) * 100}%` },
            ]}
          />
        ))}
        <PostSkeletonMedia post={post} profile={effectiveProfile} />
        {/* Mobile action bar: full-width space-between matching PostCard. */}
        <View style={styles.actions}>
          <View style={[block, styles.actionWide]} />
          <View style={[block, styles.action]} />
          <View style={[block, styles.action]} />
          {isBsky ? null : <View style={[block, styles.action]} />}
          <View style={styles.actionIcons}>
            <View style={[block, styles.actionCircle]} />
            <View style={[block, styles.actionCircle]} />
          </View>
        </View>
      </View>
      {/* Keeps data-post-skeleton parity for smoke tests. */}
      <View testID={`skeleton-kind-${effectiveKind}`} />
    </Animated.View>
  );
}

export function FeedSkeleton({
  count = FEED_INITIAL_SKELETON_COUNT,
  posts,
  source = "all",
}: {
  count?: number;
  posts?: readonly PostPreviewSource[];
  source?: FeedSkeletonSource;
} = {}) {
  const { theme } = useAppTheme();
  const items = posts?.length
    ? posts
    : Array.from<undefined>({ length: count });
  return (
    <View
      accessibilityLabel="Loading feed"
      accessibilityRole="progressbar"
      testID="feed-skeleton"
    >
      {items.map((post, index) => (
        <View
          key={`feed-skeleton-${index}`}
          style={[
            styles.separator,
            {
              borderBottomColor: theme.cardBorder,
            },
          ]}
        >
          <FeedSkeletonCard
            index={index}
            isBluesky={isBlueskySkeletonIndex(source, index)}
            post={post}
            source={source}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  action: { borderRadius: 9999, height: 28, width: 40 },
  actionCircle: { borderRadius: 9999, height: 28, width: 28 },
  actionIcons: { alignItems: "center", flexDirection: "row", gap: 4 },
  actionWide: { borderRadius: 9999, height: 28, width: 48 },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    width: "100%",
  },
  album: { flexDirection: "row", gap: 8, marginTop: 12 },
  albumFour: { borderRadius: 12, flex: 1, height: 112 },
  albumTwo: { borderRadius: 12, flex: 1, height: 144 },
  audioAvatar: { borderRadius: 9999, height: 40, width: 40 },
  audioLines: { flex: 1, gap: 8 },
  audioRow: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 12,
    height: 80,
    marginTop: 12,
    padding: 12,
  },
  audioTitle: { borderRadius: 4, height: 12, width: "66%" },
  audioWave: { borderRadius: 4, height: 20, width: "100%" },
  avatar: { borderRadius: 11, height: 36, width: 36 },
  badge: { borderRadius: 6, height: 16, width: 40 },
  bskyIcon: { opacity: 0.6 },
  card: { padding: 16 },
  content: { gap: 8, marginTop: 4 },
  contentDetail: { marginTop: 12 },
  date: { borderRadius: 6, height: 12, width: 24 },
  detailBadge: { borderRadius: 6, height: 16, width: 48 },
  detailDate: { borderRadius: 6, height: 14, width: 40 },
  detailHandle: { borderRadius: 6, height: 14, width: 80 },
  detailHandleBsky: { borderRadius: 6, height: 14, width: 112 },
  detailName: { borderRadius: 6, height: 16, width: 112 },
  dot: { fontSize: 12 },
  frame: { alignSelf: "flex-start", borderRadius: 12 },
  handle: { borderRadius: 6, height: 14, width: 64 },
  handleBsky: { borderRadius: 6, height: 14, width: 96 },
  headerCopy: { flex: 1, minWidth: 0 },
  headerRow: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  media: { marginTop: 12, width: "100%" },
  moreIcon: { borderRadius: 9999, height: 28, width: 28 },
  moreWrap: { alignItems: "center", flexDirection: "row", gap: 6 },
  name: { borderRadius: 6, height: 16, width: 96 },
  nameRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  separator: { borderBottomWidth: 1 },
  subRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  textLine: { borderRadius: 6, height: 16 },
});
