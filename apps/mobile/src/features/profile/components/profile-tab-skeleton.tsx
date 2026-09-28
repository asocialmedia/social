// Placeholder rows for a profile tab that is still fetching.
//
// The profile screen already uses a skeleton while the *header* resolves
// (profile-skeleton.tsx), so a tab that is still loading should not drop back
// to a spinner: everything around it would stay put and a spinner would blink
// in the middle of a settled screen. The placeholder has to match the shape of
// what is coming, or the tab jumps when the data lands.
//
// Which shape depends on the tab, so the caller passes the tab through rather
// than this component guessing. Grid tabs (gusts, media) get tiles in the real
// column geometry, because a stack of post-shaped cards in a two-up grid would
// resolve into a completely different layout.
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { useSkeletonPulse } from "@/components/feedback/use-skeleton-pulse";
import { FeedSkeletonCard } from "@/features/feed/components/feed-skeleton";
import { useAppTheme } from "@/theme";

import type { ProfileViewTab } from "../lib/profile-tab-memory";

// Enough rows to cover a tall phone without paying to render a long list the
// user will never see before the fetch lands.
const SKELETON_ROWS = 3;

// Tiles mirror the real geometry: 9:16 for gusts, square for media. The media
// tab sizes tiles by each item's true aspect ratio, which is unknowable before
// the data lands, so square is the right stand-in, and it is the same fallback
// mediaTileAspect uses when an upload recorded no dimensions.
function GridSkeleton({ tab }: { tab: ProfileViewTab }) {
  const { theme } = useAppTheme();
  const pulse = useSkeletonPulse();
  const isGusts = tab === "gusts";
  const aspectRatio = isGusts ? 9 / 16 : 1;
  // gustRow and mediaRow carry different gutters, so each grid keeps its own.
  const rowStyle = isGusts ? styles.gustRow : styles.mediaRow;
  const tile = {
    aspectRatio,
    backgroundColor: theme.cardBg,
    borderColor: theme.cardBorder,
    borderRadius: isGusts ? 16 : 8,
    borderWidth: 1,
  };

  return (
    <View>
      {Array.from({ length: SKELETON_ROWS * 2 }, (_, index) => (
        <View key={index} style={rowStyle}>
          <Animated.View style={[styles.gridCell, tile, { opacity: pulse }]} />
          <Animated.View style={[styles.gridCell, tile, { opacity: pulse }]} />
        </View>
      ))}
    </View>
  );
}

// The list tabs all resolve into post cards, so they reuse the feed's own card
// placeholder rather than growing a near-duplicate here. Eddies resolve into
// reply rows instead, which are two-column, so they get a matching shape.
function ListSkeleton({ tab }: { tab: ProfileViewTab }) {
  const { theme } = useAppTheme();
  const pulse = useSkeletonPulse();
  const block = { backgroundColor: theme.dividerLine };

  if (tab === "eddies") {
    return (
      <View>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <View
            key={index}
            style={[styles.replyRow, { borderBottomColor: theme.cardBorder }]}
          >
            <Animated.View
              style={[styles.replyAvatar, block, { opacity: pulse }]}
            />
            <View style={styles.replyBody}>
              <Animated.View style={[styles.line, block, { opacity: pulse }]} />
              <Animated.View
                style={[
                  styles.line,
                  styles.textPartial,
                  block,
                  { opacity: pulse },
                ]}
              />
              <Animated.View
                style={[
                  styles.line,
                  styles.textFull,
                  block,
                  { opacity: pulse },
                ]}
              />
            </View>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <View
          key={index}
          style={[styles.separator, { borderBottomColor: theme.cardBorder }]}
        >
          <FeedSkeletonCard />
        </View>
      ))}
    </View>
  );
}

export function ProfileTabSkeleton({ tab }: { tab: ProfileViewTab }) {
  return tab === "gusts" || tab === "media" ? (
    <GridSkeleton tab={tab} />
  ) : (
    <ListSkeleton tab={tab} />
  );
}

const styles = StyleSheet.create({
  gridCell: {
    flex: 1,
  },
  gustRow: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  line: {
    borderRadius: 4,
    height: 14,
    marginTop: 8,
  },
  mediaRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  replyAvatar: {
    borderRadius: 19,
    height: 38,
    width: 38,
  },
  replyBody: {
    flex: 1,
  },
  replyRow: {
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 16,
  },
  separator: {
    borderBottomWidth: 1,
  },
  textFull: { width: "100%" },
  textPartial: { width: "62%" },
});
