// Quoted-content cards for the feed: the response parent row, the Hacker
// News story card, and the community share card. Ports of web's
// ResponseParentRow, HNStoryCard and CommunityShareCard (post-card.tsx).
// Navigation targets have no mobile screens yet, so rows are static.
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { ArrowUpRight, ImageOff } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { BioContent } from "../../home/components/bio-content";
import {
  resolveProfileImageUrl,
  safeLinkUrl,
} from "../../home/components/profile-utils";
import { formatRelativeDate } from "../lib/feed-types";
import type { FeedPost } from "../lib/feed-types";
import { mediaGridImageUrl } from "../lib/media-url";

export function ResponseParentRow({ post }: { post: FeedPost }) {
  const { theme } = useAppTheme();
  const apiBase = getApiBaseUrl();
  const parent = post.parentPost;

  if (post.parentPostId && !parent) {
    return (
      <View style={styles.tombstone}>
        <View
          style={[styles.tombstoneIcon, { backgroundColor: theme.dividerLine }]}
        >
          <ImageOff color={theme.dividerText} size={18} />
        </View>
        <Text style={[styles.tombstoneText, { color: theme.dividerText }]}>
          This post is unavailable.
        </Text>
      </View>
    );
  }
  if (!parent) {
    return null;
  }
  const name = parent.user?.displayName || parent.user?.username || "unknown";
  const avatarUri = parent.user?.avatarUrl
    ? resolveProfileImageUrl(parent.user.avatarUrl, apiBase)
    : null;
  const firstMedia = parent.attachments?.[0];
  return (
    <View style={styles.parentRow}>
      <View style={styles.parentRail}>
        <View
          style={[styles.parentRailLine, { backgroundColor: theme.cardBorder }]}
        />
        {avatarUri ? (
          <Image
            contentFit="cover"
            source={{ uri: avatarUri }}
            style={styles.parentAvatar}
          />
        ) : null}
      </View>
      <View style={styles.parentBody}>
        <View style={styles.parentHead}>
          <Text
            numberOfLines={1}
            style={[styles.parentName, { color: theme.inputText }]}
          >
            {name}
          </Text>
          <Text style={[styles.parentMeta, { color: theme.dividerText }]}>
            @{parent.user?.username ?? "unknown"}
          </Text>
          {parent.isGust ? (
            <View style={styles.gustChip}>
              <Text style={styles.gustText}>Gust</Text>
            </View>
          ) : null}
          <Text style={[styles.parentMeta, { color: theme.dividerText }]}>
            · {formatRelativeDate(parent.createdAt)}
          </Text>
        </View>
        {parent.content ? (
          <BioContent apiBase={apiBase} bio={parent.content} />
        ) : null}
        {firstMedia && firstMedia.type !== "AUDIO" ? (
          <Image
            contentFit="cover"
            source={{ uri: mediaGridImageUrl(apiBase, firstMedia) }}
            style={styles.parentThumb}
          />
        ) : null}
      </View>
    </View>
  );
}

function hnTimeAgo(time: number | undefined): string {
  if (!time) {
    return "";
  }
  return formatRelativeDate(new Date(time * 1000).toISOString());
}

function openExternalUrl(url: string | undefined): void {
  if (!url) {
    return;
  }
  const safe = safeLinkUrl(url);
  if (safe) {
    void Linking.openURL(safe);
  }
}

export function HNStoryCard({ post }: { post: FeedPost }) {
  const { theme } = useAppTheme();
  const story = post.hnStoryShare;
  if (!story) {
    return null;
  }
  return (
    <View
      style={[
        styles.hnCard,
        { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
      ]}
    >
      <View style={styles.hnHead}>
        <View style={styles.hnMark}>
          <Text style={styles.hnMarkText}>Y</Text>
        </View>
        <Text style={[styles.hnEyebrow, { color: theme.dividerText }]}>
          Hacker News · {hnTimeAgo(story.time)}
        </Text>
      </View>
      <Pressable onPress={() => openExternalUrl(story.url)}>
        <Text
          numberOfLines={2}
          style={[styles.hnTitle, { color: theme.inputText }]}
        >
          {story.title}
        </Text>
      </Pressable>
      <View style={styles.hnChips}>
        {story.by ? (
          <Text style={[styles.hnChip, { color: theme.dividerText }]}>
            by {story.by}
          </Text>
        ) : null}
        {typeof story.score === "number" ? (
          <Text style={[styles.hnChip, { color: theme.dividerText }]}>
            {story.score} pts
          </Text>
        ) : null}
        {typeof story.descendants === "number" ? (
          <Text style={[styles.hnChip, { color: theme.dividerText }]}>
            {story.descendants} comments
          </Text>
        ) : null}
      </View>
      <View
        style={[styles.hnFooter, { borderTopColor: "rgba(255, 149, 0, 0.15)" }]}
      >
        <Pressable
          onPress={() =>
            openExternalUrl(
              story.storyId === undefined
                ? undefined
                : `https://news.ycombinator.com/item?id=${story.storyId}`
            )
          }
        >
          <Text style={[styles.hnLink, { color: theme.auxLink }]}>
            Browse HN
          </Text>
        </Pressable>
        <Pressable onPress={() => openExternalUrl(story.url)}>
          <Text style={[styles.hnLink, { color: theme.auxLink }]}>
            View original
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export function CommunityShareCard({ post }: { post: FeedPost }) {
  const { theme } = useAppTheme();
  const share = post.communityShare;
  const community = share?.community;
  if (!share || !community) {
    return null;
  }
  return (
    <View
      style={[
        styles.shareCard,
        { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
      ]}
    >
      <View
        style={[
          styles.shareBar,
          { backgroundColor: community.accentColor ?? "#ff9500" },
        ]}
      />
      <View style={styles.shareBody}>
        <Text style={[styles.shareName, { color: theme.inputText }]}>
          {community.name}
        </Text>
        <Text style={[styles.shareSub, { color: theme.dividerText }]}>
          Shared from a/{community.slug}
        </Text>
      </View>
      <ArrowUpRight color={theme.dividerText} size={16} />
    </View>
  );
}

const styles = StyleSheet.create({
  gustChip: {
    backgroundColor: "rgba(255, 149, 0, 0.15)",
    borderRadius: 9999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  gustText: {
    color: "#ff9500",
    fontFamily: "SofiaProMed",
    fontSize: 10,
    fontWeight: "normal",
  },
  hnCard: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    marginTop: 12,
    overflow: "hidden",
    padding: 12,
  },
  hnChip: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
    fontWeight: "normal",
  },
  hnChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  hnEyebrow: {
    fontFamily: "SofiaProMed",
    fontSize: 11,
    fontWeight: "normal",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  hnFooter: {
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 16,
    marginTop: 4,
    paddingTop: 6,
  },
  hnHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  hnLink: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
  },
  hnMark: {
    alignItems: "center",
    backgroundColor: "#ff6600",
    borderRadius: 4,
    height: 16,
    justifyContent: "center",
    width: 16,
  },
  hnMarkText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 10,
    fontWeight: "normal",
  },
  hnTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
    lineHeight: 18,
  },
  parentAvatar: {
    borderRadius: 9999,
    height: 36,
    width: 36,
    zIndex: 1,
  },
  parentBody: {
    flex: 1,
    minWidth: 0,
  },
  parentHead: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  parentMeta: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
  },
  parentName: {
    fontFamily: "SofiaProBold",
    fontSize: 13,
    fontWeight: "normal",
  },
  parentRail: {
    alignItems: "center",
    position: "relative",
    width: 36,
  },
  parentRailLine: {
    bottom: -12,
    left: "50%",
    marginLeft: -1,
    position: "absolute",
    top: -4,
    width: 2,
  },
  parentRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  parentThumb: {
    aspectRatio: 16 / 10,
    borderRadius: 12,
    marginTop: 8,
    maxHeight: 288,
    width: "100%",
  },
  shareBar: {
    borderRadius: 9999,
    height: 32,
    width: 2,
  },
  shareBody: {
    flex: 1,
    minWidth: 0,
  },
  shareCard: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  shareName: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
  shareSub: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
  },
  tombstone: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  tombstoneIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  tombstoneText: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    fontStyle: "italic",
    fontWeight: "normal",
  },
});
