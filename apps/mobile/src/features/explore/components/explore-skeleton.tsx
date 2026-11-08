// Loading placeholders for the Explore screen, a 1:1 native port of web's
// explore-masonry-skeleton, explore-gusts-skeleton and explore-people-skeleton.
// Same block shapes and sizes: the 9:16 gust rail, masonry post cards (media
// block with gust badge, 3 content lines, author row, vote pill) and user
// cards (banner, overlapping avatar, name/handle, bio, stats, follow pill);
// the Gusts tab's overlaid 9:16 tiles; the People tab's 2-column grid with
// the header row and amber-highlighted first cards. Item counts match web:
// 10 masonry items (users at slots 4 and 9), 8 gust tiles, 8 people cards.
// The pulse runs on the UI thread via useSkeletonPulse; every block is a
// flat view, no shadows stacked per bar.
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { useSkeletonPulse } from "@/components/feedback/use-skeleton-pulse";
import type { ExploreTab } from "@/features/feed/state/tab-store";
import { useAppTheme } from "@/theme";

import {
  buildMasonryLayout,
  EXPLORE_CONTINUATION_SKELETON_COUNT,
  EXPLORE_GUSTS_SKELETON_COUNT,
  EXPLORE_PEOPLE_SKELETON_COUNT,
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
          <View style={[block, styles.railIcon]} />
          <View style={[block, styles.railTitle]} />
        </View>
        <View style={[block, styles.railSeeAll]} />
      </View>
      <View style={styles.railRow}>
        {[0, 1, 2, 3].map((index) => (
          <View key={`gust-rail-${index}`} style={[block, styles.railTile]} />
        ))}
      </View>
    </Animated.View>
  );
}

// Matches ExplorePostCard: a media block (with a small gust badge chip),
// content lines, an author row, then the vote pill.
function PostSkeleton({
  aspect,
  isGust = false,
}: {
  aspect: number;
  isGust?: boolean;
}) {
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
      <View style={styles.mediaWrap}>
        <View style={[block, styles.media, { aspectRatio: aspect }]} />
        {isGust ? <View style={[block, styles.gustBadge]} /> : null}
      </View>
      <View style={styles.cardBody}>
        <View style={[block, styles.lineFull]} />
        <View style={[block, styles.lineThreeQuarter]} />
        <View style={[block, styles.lineHalf]} />
        <View style={styles.authorRow}>
          <View style={[block, styles.avatar]} />
          <View style={styles.authorLines}>
            <View style={[block, styles.authorName]} />
            <View style={[block, styles.authorHandle]} />
          </View>
        </View>
      </View>
      <View style={styles.cardFooter}>
        <View style={[block, styles.pill]} />
      </View>
    </Animated.View>
  );
}

// Matches ExploreUserCard: banner, overlapping avatar, name + username, bio
// lines, follower stats, then the follow button. The first People cards carry
// the amber recommended treatment like the real highlighted cards.
function UserSkeleton({ highlight = false }: { highlight?: boolean }) {
  const { isDark, theme } = useAppTheme();
  const { cardBg, cardBorder: defaultBorder } = theme;
  const pulse = useSkeletonPulse();
  const block = useBlock();
  let cardBackground = cardBg;
  let cardBorder = defaultBorder;
  if (highlight) {
    if (isDark) {
      cardBackground = "#3a1a0c";
      cardBorder = "rgba(251, 146, 60, 0.16)";
    } else {
      cardBackground = "#ffedd5";
      cardBorder = "rgba(234, 88, 12, 0.18)";
    }
  }
  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: cardBackground,
          borderColor: cardBorder,
          opacity: pulse,
        },
      ]}
    >
      <View style={[block, styles.banner]} />
      <View style={styles.cardBody}>
        <View style={[block, styles.userAvatar]} />
        <View style={styles.userNameLines}>
          <View style={[block, styles.userName]} />
          <View style={[block, styles.userHandle]} />
        </View>
        <View style={[block, styles.lineFull]} />
        <View style={[block, styles.lineAlmostFull]} />
        <View style={styles.userStats}>
          <View style={[block, styles.statWide]} />
          <View style={[block, styles.stat]} />
        </View>
        <View style={[block, styles.followPill]} />
      </View>
    </Animated.View>
  );
}

function SkeletonCard({
  highlight,
  item,
}: {
  highlight?: boolean;
  item: SkeletonItem;
}) {
  return item.kind === "user" ? (
    <UserSkeleton highlight={highlight} />
  ) : (
    <PostSkeleton aspect={item.aspect ?? 4 / 5} />
  );
}

// The masonry body for For you / Trending: the gust rail then the two
// evenly-split columns of post and user cards. While paginating, web appends
// two plain post placeholders per column instead of the rail.
export function ExploreMasonrySkeleton({
  continuation = false,
}: {
  continuation?: boolean;
}) {
  if (continuation) {
    const items = Array.from(
      { length: EXPLORE_CONTINUATION_SKELETON_COUNT },
      (_, index) => ({ aspect: 4 / 5, key: index, kind: "post" as const })
    );
    const left = items.filter((_, index) => index % 2 === 0);
    const right = items.filter((_, index) => index % 2 === 1);
    return (
      <View style={styles.body}>
        <View style={styles.masonryRow}>
          <View style={styles.masonryColumn}>
            {left.map((item) => (
              <PostSkeleton
                aspect={item.aspect}
                key={`more-left-${item.key}`}
              />
            ))}
          </View>
          <View style={styles.masonryColumn}>
            {right.map((item) => (
              <PostSkeleton
                aspect={item.aspect}
                key={`more-right-${item.key}`}
              />
            ))}
          </View>
        </View>
      </View>
    );
  }
  const { left, right } = splitIntoColumns(buildMasonryLayout());
  return (
    <View style={styles.body}>
      <GustRailSkeleton />
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

// The People header row: the section title and the 3D refresh pill.
function PeopleHeaderSkeleton() {
  const pulse = useSkeletonPulse();
  const block = useBlock();
  return (
    <Animated.View style={[styles.peopleHeader, { opacity: pulse }]}>
      <View style={[block, styles.peopleTitle]} />
      <View style={[block, styles.peopleRefresh]} />
    </Animated.View>
  );
}

// The People tab body: the header row (title + refresh pill) then a 2-column
// grid of user cards, the first five highlighted like web's Recommended
// treatment. Web hides the search bar on mobile, so there is none here.
export function ExplorePeopleSkeleton({
  continuation = false,
}: {
  continuation?: boolean;
}) {
  const count = continuation ? 2 : EXPLORE_PEOPLE_SKELETON_COUNT;
  return (
    <View style={styles.peopleBody}>
      {continuation ? null : <PeopleHeaderSkeleton />}
      <View style={styles.peopleGrid}>
        <View style={styles.masonryColumn}>
          {Array.from({ length: count }, (_, index) =>
            index % 2 === 0 ? (
              <UserSkeleton
                highlight={!continuation && index < 5}
                key={`people-${index}`}
              />
            ) : null
          )}
        </View>
        <View style={styles.masonryColumn}>
          {Array.from({ length: count }, (_, index) =>
            index % 2 === 1 ? (
              <UserSkeleton
                highlight={!continuation && index < 5}
                key={`people-${index}`}
              />
            ) : null
          )}
        </View>
      </View>
    </View>
  );
}

// Matches the Gusts grid tile: a 9:16 tile with the author row and caption
// overlaid at the bottom.
function GustSkeleton() {
  const { theme } = useAppTheme();
  const pulse = useSkeletonPulse();
  const block = useBlock();
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
      <View style={[block, styles.gustFill]} />
      <View style={styles.gustCopy}>
        <View style={styles.authorRow}>
          <View style={[block, styles.gustAvatar]} />
          <View style={[block, styles.gustAuthorName]} />
        </View>
        <View style={[block, styles.gustCaption]} />
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
    const count = continuation ? 1 : EXPLORE_GUSTS_SKELETON_COUNT / 2;
    content = (
      <View style={[styles.body, continuation ? null : styles.bodyFlushTop]}>
        <View style={styles.masonryRow}>
          {[0, 1].map((column) => (
            <View key={column} style={styles.masonryColumn}>
              {Array.from({ length: count }, (_, row) => (
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
      style={{ marginHorizontal: tab === "people" ? 0 : -8 }}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  authorHandle: { height: 10, width: 64 },
  authorLines: { flex: 1, gap: 4 },
  authorName: { height: 12, width: 96 },
  authorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  avatar: { borderRadius: 9999, height: 32, width: 32 },
  banner: { height: 80, width: "100%" },
  body: { paddingHorizontal: 16, paddingTop: 16 },
  bodyFlushTop: { paddingTop: 0 },
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    overflow: "hidden",
  },
  cardBody: { gap: 10, padding: 12 },
  cardFooter: { paddingBottom: 12, paddingHorizontal: 12 },
  followPill: { borderRadius: 9999, height: 32, marginTop: 2, width: "100%" },
  gustAuthorName: { flex: 1, height: 12 },
  gustAvatar: { borderRadius: 12, height: 32, width: 32 },
  gustBadge: {
    borderRadius: 9999,
    height: 20,
    left: 8,
    position: "absolute",
    top: 8,
    width: 56,
  },
  gustCaption: { height: 12, width: "75%" },
  gustCopy: { bottom: 16, gap: 12, left: 12, position: "absolute", right: 12 },
  gustFill: {
    borderRadius: 16,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  gustTile: {
    aspectRatio: 9 / 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    overflow: "hidden",
  },
  lineAlmostFull: { borderRadius: 6, height: 14, width: "83%" },
  lineFull: { borderRadius: 6, height: 14, width: "100%" },
  lineHalf: { borderRadius: 6, height: 14, width: "50%" },
  lineThreeQuarter: { borderRadius: 6, height: 14, width: "75%" },
  masonryColumn: { flex: 1 },
  masonryRow: { flexDirection: "row", gap: 16 },
  media: { borderRadius: 0, width: "100%" },
  mediaWrap: { position: "relative", width: "100%" },
  peopleBody: { paddingTop: 16 },
  peopleGrid: { flexDirection: "row", gap: 16 },
  peopleHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  peopleRefresh: { borderRadius: 9999, height: 36, width: 112 },
  peopleTitle: { borderRadius: 6, height: 16, width: 160 },
  pill: { borderRadius: 9999, height: 32, width: 80 },
  rail: { gap: 12, marginBottom: 24 },
  railHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  railIcon: { borderRadius: 12, height: 36, width: 36 },
  railRow: { flexDirection: "row", gap: 12 },
  railSeeAll: { borderRadius: 6, height: 16, width: 64 },
  railTile: { aspectRatio: 9 / 16, borderRadius: 16, width: 144 },
  railTitle: { borderRadius: 6, height: 16, width: 112 },
  railTitleGroup: { alignItems: "center", flexDirection: "row", gap: 10 },
  stat: { borderRadius: 6, height: 12, width: 48 },
  statWide: { borderRadius: 6, height: 12, width: 56 },
  userAvatar: {
    borderRadius: 12,
    height: 44,
    marginTop: -36,
    width: 44,
  },
  userHandle: { borderRadius: 6, height: 12, width: "50%" },
  userName: { borderRadius: 6, height: 16, width: "66%" },
  userNameLines: { gap: 6, marginTop: 8 },
  userStats: { flexDirection: "row", gap: 12, marginTop: 2 },
});
