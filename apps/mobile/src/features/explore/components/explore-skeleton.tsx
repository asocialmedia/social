// Loading placeholders for the Explore screen, matching the real card
// structures so a load reads as the content it is about to become rather than
// a bare grey block. Mirrors web's explore-masonry-skeleton and
// explore-people-skeleton: a 9:16 gust rail, then a masonry of post cards and
// user cards; the People stream is a single column of user cards. Uses the
// shared skeleton pulse so it animates in step with the feed and notification
// skeletons.
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { useSkeletonPulse } from "@/components/feedback/use-skeleton-pulse";
import type { ExploreTab } from "@/features/feed/state/tab-store";
import { useAppTheme } from "@/theme";

import {
  buildMasonryLayout,
  splitIntoColumns,
} from "../lib/explore-skeleton-layout";
import type { SkeletonItem } from "../lib/explore-skeleton-layout";

function useBlock() {
  const { theme } = useAppTheme();
  return { backgroundColor: theme.dividerLine };
}

// The "Trending Gusts" rail: a header row then a horizontal row of 9:16 tiles.
function GustRailSkeleton() {
  const pulse = useSkeletonPulse();
  const block = useBlock();
  return (
    <Animated.View style={[styles.rail, { opacity: pulse }]}>
      <View style={styles.railHeader}>
        <View style={styles.railTitleGroup}>
          <View style={[styles.railIcon, block]} />
          <View style={styles.railTitleLines}>
            <View style={[styles.line, block, styles.railTitle]} />
            <View style={[styles.line, block, styles.railSubtitle]} />
          </View>
        </View>
        <View style={[styles.line, block, styles.railSeeAll]} />
      </View>
      <View style={styles.railRow}>
        {[0, 1, 2, 3].map((index) => (
          <View key={`gust-rail-${index}`} style={[styles.railTile, block]} />
        ))}
      </View>
    </Animated.View>
  );
}

// Matches ExplorePostCard: a media block (aspect varies), content lines, then
// an author row and a footer pill.
function PostSkeleton({ aspect }: { aspect: number }) {
  const { theme } = useAppTheme();
  const pulse = useSkeletonPulse();
  const block = useBlock();
  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          opacity: pulse,
        },
      ]}
    >
      <View style={[styles.visual, { aspectRatio: aspect }, block]} />
      <View style={styles.cardBody}>
        <View style={[styles.line, block, styles.textFull]} />
        <View style={[styles.line, block, styles.textWide]} />
        <View style={[styles.line, block, styles.textHalf]} />
        <View style={styles.authorRow}>
          <View style={[styles.avatar, block]} />
          <View style={styles.authorLines}>
            <View style={[styles.line, block, styles.authorName]} />
            <View style={[styles.line, block, styles.authorHandle]} />
          </View>
        </View>
      </View>
      <View style={styles.cardFooter}>
        <View style={[styles.pill, block]} />
      </View>
    </Animated.View>
  );
}

// Matches ExploreUserCard: banner strip, overlapping avatar, name/handle, bio
// lines, stats, then a full-width follow pill.
function UserSkeleton() {
  const { theme } = useAppTheme();
  const pulse = useSkeletonPulse();
  const block = useBlock();
  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          opacity: pulse,
        },
      ]}
    >
      <View style={[styles.banner, block]} />
      <View style={styles.cardBody}>
        <View style={[styles.userAvatar, block]} />
        <View style={styles.userNameLines}>
          <View style={[styles.line, block, styles.userName]} />
          <View style={[styles.line, block, styles.userHandle]} />
        </View>
        <View style={[styles.line, block, styles.textFull]} />
        <View style={[styles.line, block, styles.textWide]} />
        <View style={styles.userStats}>
          <View style={[styles.line, block, styles.stat]} />
          <View style={[styles.line, block, styles.stat]} />
        </View>
        <View style={[styles.followPill, block]} />
      </View>
    </Animated.View>
  );
}

function SkeletonCard({ item }: { item: SkeletonItem }) {
  return item.kind === "user" ? (
    <UserSkeleton />
  ) : (
    <PostSkeleton aspect={item.aspect ?? 4 / 5} />
  );
}

// The masonry body for For you / Trending / Gusts: the gust rail then the two
// evenly-split columns of post and user cards.
export function ExploreMasonrySkeleton({
  continuation = false,
}: {
  continuation?: boolean;
}) {
  const { left, right } = splitIntoColumns(
    buildMasonryLayout(continuation ? [4 / 5, 3 / 4, 1, 4 / 5] : undefined)
  );
  return (
    <View style={styles.body}>
      {continuation ? null : <GustRailSkeleton />}
      <View style={styles.masonryRow}>
        <View style={styles.masonryColumn}>
          {left.map((item, index) => (
            <SkeletonCard item={item} key={`left-${index}`} />
          ))}
        </View>
        <View style={styles.masonryColumn}>
          {right.map((item, index) => (
            <SkeletonCard item={item} key={`right-${index}`} />
          ))}
        </View>
      </View>
    </View>
  );
}

// The People tab body: a single column of user cards.
export function ExplorePeopleSkeleton({
  continuation = false,
}: {
  continuation?: boolean;
}) {
  return (
    <View style={styles.body}>
      <View style={styles.peopleColumn}>
        {Array.from({ length: continuation ? 2 : 6 }, (_, index) => (
          <UserSkeleton key={`people-${index}`} />
        ))}
      </View>
    </View>
  );
}

function GustSkeleton() {
  const pulse = useSkeletonPulse();
  const block = useBlock();
  const { theme } = useAppTheme();
  return (
    <Animated.View
      style={[
        styles.gustTile,
        {
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
          opacity: pulse,
        },
      ]}
    >
      <View style={[styles.gustBadge, block]} />
      <View style={styles.gustCopy}>
        <View style={styles.authorRow}>
          <View style={[styles.avatar, block]} />
          <View style={styles.authorLines}>
            <View style={[styles.line, styles.textWide, block]} />
            <View style={[styles.line, styles.textHalf, block]} />
          </View>
        </View>
        <View style={[styles.line, styles.textWide, block]} />
      </View>
    </Animated.View>
  );
}

export function ExploreLoadingSkeleton({
  tab,
  continuation = false,
}: {
  tab: ExploreTab;
  continuation?: boolean;
}) {
  let content;
  if (tab === "people") {
    content = <ExplorePeopleSkeleton continuation={continuation} />;
  } else if (tab === "gusts") {
    content = (
      <View style={[styles.body, continuation ? null : { paddingTop: 0 }]}>
        <View style={styles.masonryRow}>
          {[0, 1].map((column) => (
            <View key={column} style={styles.masonryColumn}>
              {Array.from({ length: continuation ? 1 : 3 }, (_, row) => (
                <GustSkeleton key={row} />
              ))}
            </View>
          ))}
        </View>
      </View>
    );
  } else {
    content = <ExploreMasonrySkeleton continuation={continuation} />;
  }
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={
        continuation ? "Loading more Explore items" : "Loading Explore items"
      }
      testID={`explore-${tab}-${continuation ? "footer" : "initial"}-skeleton`}
      style={{ marginHorizontal: tab === "people" ? -16 : -8 }}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  authorHandle: { height: 10, width: 56 },
  authorLines: { flex: 1, gap: 6 },
  authorName: { height: 12, width: 96 },
  authorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  avatar: { borderRadius: 10, height: 32, width: 32 },
  banner: { height: 80, width: "100%" },
  body: { paddingHorizontal: 16, paddingTop: 16 },
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    overflow: "hidden",
  },
  cardBody: { gap: 8, padding: 12 },
  cardFooter: { paddingBottom: 12, paddingHorizontal: 12 },
  followPill: { borderRadius: 9999, height: 32, marginTop: 4, width: "100%" },
  gustBadge: { borderRadius: 999, height: 24, width: 64 },
  gustCopy: { gap: 10 },
  gustTile: {
    aspectRatio: 9 / 16,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "space-between",
    marginBottom: 16,
    padding: 12,
  },
  line: { borderRadius: 4, height: 12 },
  masonryColumn: { flex: 1 },
  masonryRow: { flexDirection: "row", gap: 16 },
  peopleColumn: { gap: 0 },
  pill: { borderRadius: 9999, height: 32, width: 80 },
  rail: { gap: 12, marginBottom: 24 },
  railHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  railIcon: { borderRadius: 9999, height: 16, width: 16 },
  railRow: { flexDirection: "row", gap: 12 },
  railSeeAll: { height: 12, width: 56 },
  railSubtitle: { height: 10, width: 140 },
  railTile: { aspectRatio: 9 / 16, borderRadius: 14, width: 144 },
  railTitle: { height: 14, width: 100 },
  railTitleGroup: { alignItems: "center", flexDirection: "row", gap: 8 },
  railTitleLines: { gap: 6 },
  stat: { height: 10, width: 48 },
  textFull: { width: "100%" },
  textHalf: { width: "50%" },
  textWide: { width: "75%" },
  userAvatar: {
    borderRadius: 14,
    height: 44,
    marginTop: -28,
    width: 44,
  },
  userHandle: { height: 10, width: 72 },
  userName: { height: 14, width: "60%" },
  userNameLines: { gap: 6, marginTop: 8 },
  userStats: { flexDirection: "row", gap: 12, marginTop: 2 },
  visual: { borderRadius: 0, width: "100%" },
});
