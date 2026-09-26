// Web's `components/hackernews/hn-story-card.tsx`, ported row for row: the Y
// badge with the "Hacker News" label, the relative time and the save control on
// the top line, the title with its domain chip, then the by / points / comments
// chips, and finally the two row actions ("Reshare as fleet" into the composer
// and "Copy" of the link).
//
// The orange wash web applies on hover has no native equivalent, so the row
// carries the resting state only rather than faking a hover it cannot detect.
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import {
  Bookmark,
  Copy,
  Link2,
  MessageCircle,
  Share2,
  ThumbsUp,
  User,
} from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";

import { toast } from "@/components/feedback/toast";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { RAIL_ACTIVE, metaChip } from "@/components/surface/recipes";
import { logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

import type { HnStory } from "../lib/hackernews-api";

export function hnItemUrl(id: number): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

export function hnUserUrl(by: string): string {
  return `https://news.ycombinator.com/user?id=${by}`;
}

// Web uses date-fns' formatDistanceToNow; this is the same ladder, expressed
// for the coarse units a story row needs.
export function timeAgo(unixSeconds: number, now: number): string {
  if (!unixSeconds) {
    return "";
  }
  const seconds = Math.max(0, Math.round(now / 1000 - unixSeconds));
  if (seconds < 60) {
    return "less than a minute ago";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 31) {
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  const months = Math.round(days / 30.44);
  if (months < 12) {
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** Opens a link, reporting the one failure mode a reader can act on. */
function openExternal(url: string): void {
  const open = async () => {
    try {
      await Linking.openURL(url);
    } catch {
      toast({
        description: "Couldn't open that link",
        title: "No luck",
        variant: "destructive",
      });
    }
  };
  void open();
}

export function HnStoryCard({
  bookmarked,
  now,
  onReshare,
  onToggleBookmark,
  onVisit,
  story,
}: {
  bookmarked: boolean;
  // Passed in rather than read from the clock during render: the relative time
  // is then stable for a re-render, and the screen decides when it ticks.
  now: number;
  onReshare: (story: HnStory) => void;
  onToggleBookmark: (story: HnStory) => void;
  onVisit: (story: HnStory) => void;
  story: HnStory;
}) {
  const { isDark, theme } = useAppTheme();
  const chip = metaChip(isDark);
  // Web links the title to the story and the comments chip to the discussion.
  // The port had both pointing at the story, under a label that said
  // "discussion", so the chip went somewhere other than where it claimed.
  const target = story.url ?? hnItemUrl(story.id);
  const discussionUrl = hnItemUrl(story.id);

  // Web's Copy uses the platform share sheet where there is one and falls
  // back to the clipboard. This was previously a function called `copy` that
  // only opened the story URL, so the row action it fed did the wrong thing.
  const copyLink = useCallback(async () => {
    try {
      // The platform sheet is the richer affordance and is what web prefers,
      // but it can be unavailable or refused, so the clipboard is the fallback
      // rather than an either/or decided up front.
      await Share.share({ message: target, title: story.title, url: target });
    } catch {
      // The sheet was unavailable or refused, so the clipboard is the
      // fallback rather than an either/or decided up front.
      try {
        await Clipboard.setStringAsync(target);
      } catch (error) {
        logWarn("hackernews.copy_failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
        toast({
          description: "Couldn't copy that link",
          title: "No luck",
          variant: "destructive",
        });
        return;
      }
      toast({
        description: "Link copied, paste it anywhere",
        title: "Link Copied",
      });
    }
  }, [story.title, target]);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
      ]}
    >
      <View style={styles.top}>
        <View style={styles.brand}>
          <Gradient3D
            colors={["#ff9500", "#e65500"]}
            radius={6}
            shadows="inset 0 1px 1px rgba(255,255,255,0.35), 0 1px 2px rgba(154,52,18,0.3)"
            style={styles.logo}
          >
            <Text style={styles.logoText}>Y</Text>
          </Gradient3D>
          <Text
            style={[
              styles.brandText,
              { color: isDark ? "#fb923c" : "#ea580c" },
            ]}
          >
            Hacker News
          </Text>
        </View>
        <View style={styles.topRight}>
          <Text style={[styles.time, { color: theme.dividerText }]}>
            {timeAgo(story.time, now)}
          </Text>
          <Pressable
            accessibilityLabel={bookmarked ? "Remove bookmark" : "Save story"}
            accessibilityRole="button"
            accessibilityState={{ checked: bookmarked }}
            hitSlop={6}
            onPress={() => {
              onToggleBookmark(story);
            }}
            style={styles.save}
          >
            {bookmarked ? (
              <Gradient3D
                colors={RAIL_ACTIVE.gold.colors}
                radius={9999}
                shadows={RAIL_ACTIVE.gold.shadows}
                style={styles.saveActive}
              >
                <Bookmark color="#ffffff" fill="#ffffff" size={16} />
              </Gradient3D>
            ) : (
              <Bookmark color={chip.color} size={16} />
            )}
          </Pressable>
        </View>
      </View>

      <View style={styles.titleRow}>
        <Pressable
          accessibilityLabel={`Open ${story.title}`}
          accessibilityRole="link"
          onPress={() => {
            onVisit(story);
          }}
          style={styles.titlePress}
        >
          <Text
            numberOfLines={2}
            style={[styles.title, { color: theme.inputText }]}
          >
            {story.title}
          </Text>
        </Pressable>
        {story.domain ? (
          <View
            style={[
              styles.domain,
              { backgroundColor: chip.background, borderColor: chip.border },
            ]}
          >
            <Link2 color={chip.color} size={12} />
            <Text
              numberOfLines={1}
              style={[styles.domainText, { color: chip.color }]}
            >
              {story.domain}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.chips}>
        <View
          style={[
            styles.chip,
            { backgroundColor: chip.background, borderColor: chip.border },
          ]}
        >
          <User color={chip.color} size={12} />
          <Text
            numberOfLines={1}
            style={[styles.chipText, { color: chip.color }]}
          >
            {story.by}
          </Text>
        </View>
        <View
          style={[
            styles.chip,
            { backgroundColor: chip.background, borderColor: chip.border },
          ]}
        >
          <ThumbsUp color={chip.color} size={12} />
          <Text style={[styles.chipText, { color: chip.color }]}>
            {story.score} pts
          </Text>
        </View>
        <Pressable
          accessibilityLabel={`Open the HackerNews discussion, ${story.comments} comments`}
          accessibilityRole="link"
          onPress={() => {
            openExternal(discussionUrl);
          }}
          style={[
            styles.chip,
            { backgroundColor: chip.background, borderColor: chip.border },
          ]}
        >
          <MessageCircle color={chip.color} size={12} />
          <Text style={[styles.chipText, { color: chip.color }]}>
            {story.comments} {story.comments === 1 ? "comment" : "comments"}
          </Text>
        </Pressable>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel="Reshare this story as a fleet"
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => onReshare(story)}
          style={styles.action}
        >
          <Share2 color={chip.color} size={14} />
          <Text style={[styles.actionText, { color: chip.color }]}>
            Reshare as fleet
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Copy the link to this story"
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => {
            void copyLink();
          }}
          style={[styles.action, styles.actionEnd]}
        >
          <Copy color={chip.color} size={14} />
          <Text style={[styles.actionText, { color: chip.color }]}>Copy</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    paddingVertical: 6,
  },
  actionEnd: { marginLeft: "auto" },
  actionText: { fontFamily: "SofiaProMed", fontSize: 12 },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingTop: 2,
  },
  brand: { alignItems: "center", flexDirection: "row", gap: 8, minWidth: 0 },
  brandText: {
    fontFamily: "SofiaProBold",
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  chip: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    maxWidth: 120,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: { fontFamily: "SofiaProReg", fontSize: 11 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  domain: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    maxWidth: "40%",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  domainText: { fontFamily: "SofiaProReg", fontSize: 11 },
  logo: { height: 20, width: 20 },
  logoText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 10,
  },
  save: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  saveActive: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  time: { fontFamily: "SofiaProReg", fontSize: 11 },
  title: { fontFamily: "SofiaProBold", fontSize: 14, lineHeight: 19 },
  titlePress: { flex: 1, minWidth: 0 },
  titleRow: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  top: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  topRight: { alignItems: "center", flexDirection: "row", gap: 8 },
});
