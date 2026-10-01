// Quoted-content cards for the feed: the response parent row, the Hacker
// News story card, and the community share card. Ports of web's
// ResponseParentRow, HNStoryCard and CommunityShareCard (post-card.tsx).
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import {
  ArrowUpRight,
  ImageOff,
  Link2,
  MessageCircle,
  ThumbsUp,
  User,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { GestureResponderEvent } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { resolveCommunityAccentColor } from "@/features/communities/lib/community-accents";
import { UserBadge } from "@/features/home/components/user-badge";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { BioContent } from "../../home/components/bio-content";
import { safeLinkUrl } from "../../home/components/profile-utils";
import { formatRelativeDate } from "../lib/feed-types";
import type { FeedPost } from "../lib/feed-types";
import { mediaGridImageUrl } from "../lib/media-url";

// `.hn-story-solid` panel shadows, light + dark.
const HN_CARD_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.9), inset 0 1px 2px rgba(255, 255, 255, 0.95), inset 0 -1px 2px rgba(154, 52, 18, 0.05), 0 1px 2px rgba(154, 52, 18, 0.05), 0 3px 8px rgba(154, 52, 18, 0.06)";
const HN_CARD_SHADOWS_DARK =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.05), inset 0 1px 2px rgba(255, 255, 255, 0.04), inset 0 -1px 2px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.18), 0 3px 8px rgba(0, 0, 0, 0.15)";

// `.hn-chip` resting shadows, light + dark.
const HN_CHIP_SHADOWS =
  "inset 0 1px 1px rgba(255, 255, 255, 0.6), 0 1px 1px rgba(154, 52, 18, 0.06)";
const HN_CHIP_SHADOWS_DARK =
  "inset 0 1px 1px rgba(255, 255, 255, 0.05), 0 1px 1px rgba(0, 0, 0, 0.2)";

// Gradient Y mark: inner highlight + warm drop.
const HN_MARK_SHADOWS =
  "inset 0 1px 1px rgba(255, 255, 255, 0.35), 0 1px 2px rgba(154, 52, 18, 0.3)";

export function ResponseParentRow({ post }: { post: FeedPost }) {
  const { theme, isDark } = useAppTheme();
  const router = useRouter();
  const apiBase = getApiBaseUrl();
  const parent = post.parentPost;

  if (post.parentPostId && !parent) {
    return (
      <View style={styles.parentRow}>
        <View style={styles.parentRail}>
          <View
            style={[
              styles.parentRailLine,
              { backgroundColor: theme.cardBorder },
            ]}
          />
          <View
            style={[
              styles.tombstoneIcon,
              {
                backgroundColor: isDark ? "#232323" : "#f1f3f5",
                borderColor: theme.cardBorder,
              },
            ]}
          >
            <ImageOff color={theme.dividerText} size={16} />
          </View>
        </View>
        <View style={styles.tombstoneBody}>
          <Text style={[styles.tombstoneText, { color: theme.dividerText }]}>
            This post is unavailable
          </Text>
        </View>
      </View>
    );
  }
  if (!parent) {
    return null;
  }
  const name = parent.user?.displayName || parent.user?.username || "unknown";
  const username = parent.user?.username;
  const firstMedia = parent.attachments?.[0];
  const parentPostId = parent.id || post.parentPostId;

  const openParentPost = (event: GestureResponderEvent) => {
    event.stopPropagation();
    if (!parentPostId) {
      return;
    }
    // Full id: truncated prefixes 404 when they match more than one post.
    router.push({
      params: { postId: parentPostId },
      pathname: "/posts/[postId]",
    });
  };

  const openAuthor = (event: GestureResponderEvent) => {
    event.stopPropagation();
    if (!username) {
      return;
    }
    router.push({
      params: { username },
      pathname: "/users/[username]",
    });
  };

  return (
    <View style={styles.parentRow}>
      <View style={styles.parentRail}>
        <View
          style={[styles.parentRailLine, { backgroundColor: theme.cardBorder }]}
        />
        <Pressable
          accessibilityLabel={`Open ${name}'s profile`}
          accessibilityRole="link"
          disabled={!username}
          onPress={openAuthor}
          style={styles.parentAvatarPressable}
        >
          <UserAvatar
            size={36}
            url={parent.user?.avatarUrl}
            userId={parent.user?.id}
            username={parent.user?.username}
          />
        </Pressable>
      </View>
      <Pressable
        accessibilityLabel={`Parent post by ${name}`}
        accessibilityRole="button"
        onPress={openParentPost}
        style={styles.parentBody}
      >
        <View style={styles.parentHead}>
          <Pressable
            accessibilityLabel={`Open ${name}'s profile`}
            accessibilityRole="link"
            disabled={!username}
            onPress={openAuthor}
            style={styles.parentNamePressable}
          >
            <Text
              numberOfLines={1}
              style={[styles.parentName, { color: theme.inputText }]}
            >
              {name}
            </Text>
          </Pressable>
          <UserBadge
            badge={parent.user?.badge}
            badges={parent.user?.badges}
            communityRoles={parent.user?.communityMemberships}
          />
          <Pressable
            accessibilityLabel={`Open @${username}'s profile`}
            accessibilityRole="link"
            disabled={!username}
            onPress={openAuthor}
            style={styles.parentHandlePressable}
          >
            <Text
              numberOfLines={1}
              style={[styles.parentMeta, { color: theme.dividerText }]}
            >
              @{username ?? "unknown"}
            </Text>
          </Pressable>
          {parent.isGust ? (
            <View style={styles.gustChip}>
              <Text style={styles.gustText}>Gust</Text>
            </View>
          ) : null}
          <Text style={[styles.parentMeta, { color: theme.dividerText }]}>
            ·
          </Text>
          <Text style={[styles.parentMeta, { color: theme.dividerText }]}>
            {formatRelativeDate(parent.createdAt)}
          </Text>
        </View>
        {parent.content ? (
          <View style={styles.parentContent}>
            <BioContent
              apiBase={apiBase}
              bio={parent.content}
              clampLength={400}
            />
          </View>
        ) : null}
        {firstMedia && firstMedia.type !== "AUDIO" ? (
          <Image
            contentFit="cover"
            source={{ uri: mediaGridImageUrl(apiBase, firstMedia) }}
            style={styles.parentThumb}
          />
        ) : null}
        {!parent.content && !firstMedia ? (
          <Text style={[styles.parentEmpty, { color: theme.dividerText }]}>
            Post
          </Text>
        ) : null}
      </Pressable>
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

function hnDomain(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// Hacker News reshare card: 1:1 port of web's HNStoryCard. Orange-tinted
// gradient panel, gradient Y mark with the eyebrow left and the story time
// right, title row with a domain chip, icon stat chips, and a split footer
// (Browse HN / View original).
export function HNStoryCard({ post }: { post: FeedPost }) {
  const { isDark, theme } = useAppTheme();
  const story = post.hnStoryShare;
  if (!story) {
    return null;
  }
  const accent = isDark ? "#fdba74" : "#c2410c";
  const domain = hnDomain(story.url);
  return (
    <View
      style={[
        styles.hnCard,
        {
          borderColor: isDark
            ? "rgba(251, 146, 60, 0.16)"
            : "rgba(234, 88, 12, 0.18)",
          boxShadow: isDark ? HN_CARD_SHADOWS_DARK : HN_CARD_SHADOWS,
        },
      ]}
    >
      <LinearGradient
        colors={isDark ? ["#4a2410", "#3a1a0c"] : ["#fff7ed", "#ffedd5"]}
        end={{ x: 0.5, y: 1 }}
        start={{ x: 0.5, y: 0 }}
        style={styles.hnGradient}
      >
        <View style={styles.hnHead}>
          <View style={styles.hnHeadLeft}>
            <LinearGradient
              colors={["#ff9500", "#e65500"]}
              end={{ x: 0.5, y: 1 }}
              start={{ x: 0.5, y: 0 }}
              style={[styles.hnMark, { boxShadow: HN_MARK_SHADOWS }]}
            >
              <Text style={styles.hnMarkText}>Y</Text>
            </LinearGradient>
            <Text style={[styles.hnEyebrow, { color: accent }]}>
              Hacker News
            </Text>
          </View>
          <Text style={[styles.hnTime, { color: theme.dividerText }]}>
            {hnTimeAgo(story.time)}
          </Text>
        </View>
        <View style={styles.hnTitleRow}>
          <Pressable
            onPress={() => openExternalUrl(story.url)}
            style={styles.hnTitlePress}
          >
            <Text
              numberOfLines={2}
              style={[styles.hnTitle, { color: theme.inputText }]}
            >
              {story.title}
            </Text>
          </Pressable>
          {domain ? (
            <View
              style={[
                styles.hnChip,
                styles.hnDomain,
                {
                  backgroundColor: "rgba(255, 149, 0, 0.12)",
                  borderColor: isDark
                    ? "rgba(251, 146, 60, 0.15)"
                    : "rgba(234, 88, 12, 0.18)",
                  boxShadow: isDark ? HN_CHIP_SHADOWS_DARK : HN_CHIP_SHADOWS,
                },
              ]}
            >
              <Link2 color={accent} size={12} />
              <Text
                numberOfLines={1}
                style={[
                  styles.hnChipText,
                  styles.hnChipTruncate,
                  { color: accent },
                ]}
              >
                {domain}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.hnChips}>
          {story.by ? (
            <View
              style={[
                styles.hnChip,
                {
                  backgroundColor: "rgba(255, 149, 0, 0.12)",
                  borderColor: isDark
                    ? "rgba(251, 146, 60, 0.15)"
                    : "rgba(234, 88, 12, 0.18)",
                  boxShadow: isDark ? HN_CHIP_SHADOWS_DARK : HN_CHIP_SHADOWS,
                },
              ]}
            >
              <User color={accent} size={12} />
              <Text
                numberOfLines={1}
                style={[
                  styles.hnChipText,
                  styles.hnChipTruncate,
                  styles.hnBy,
                  { color: accent },
                ]}
              >
                {story.by}
              </Text>
            </View>
          ) : null}
          {typeof story.score === "number" ? (
            <View
              style={[
                styles.hnChip,
                {
                  backgroundColor: "rgba(255, 149, 0, 0.12)",
                  borderColor: isDark
                    ? "rgba(251, 146, 60, 0.15)"
                    : "rgba(234, 88, 12, 0.18)",
                  boxShadow: isDark ? HN_CHIP_SHADOWS_DARK : HN_CHIP_SHADOWS,
                },
              ]}
            >
              <ThumbsUp color={accent} size={12} />
              <Text style={[styles.hnChipText, { color: accent }]}>
                {story.score} pts
              </Text>
            </View>
          ) : null}
          {typeof story.descendants === "number" ? (
            <Pressable
              onPress={() =>
                openExternalUrl(
                  story.storyId === undefined
                    ? undefined
                    : `https://news.ycombinator.com/item?id=${story.storyId}`
                )
              }
              style={[
                styles.hnChip,
                {
                  backgroundColor: "rgba(255, 149, 0, 0.12)",
                  borderColor: isDark
                    ? "rgba(251, 146, 60, 0.15)"
                    : "rgba(234, 88, 12, 0.18)",
                  boxShadow: isDark ? HN_CHIP_SHADOWS_DARK : HN_CHIP_SHADOWS,
                },
              ]}
            >
              <MessageCircle color={accent} size={12} />
              <Text style={[styles.hnChipText, { color: accent }]}>
                {story.descendants}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <View
          style={[
            styles.hnFooter,
            { borderTopColor: "rgba(249, 115, 22, 0.15)" },
          ]}
        >
          <Pressable
            onPress={() => openExternalUrl("https://news.ycombinator.com")}
            style={styles.hnFooterLink}
          >
            <Text style={[styles.hnLink, { color: accent }]}>Browse HN →</Text>
          </Pressable>
          <Pressable
            onPress={() => openExternalUrl(story.url)}
            style={styles.hnFooterLink}
          >
            <ArrowUpRight color={accent} size={14} />
            <Text style={[styles.hnLink, { color: accent }]}>
              View original
            </Text>
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

export function CommunityShareCard({ post }: { post: FeedPost }) {
  const { theme, isDark } = useAppTheme();
  const router = useRouter();
  const share = post.communityShare;
  const shareCommunity = share?.community;
  if (!share || !shareCommunity) {
    return null;
  }
  const communitySlug = shareCommunity.slug || post.community?.slug || "";
  const communityName =
    post.community?.name ?? shareCommunity.name ?? communitySlug;
  const accentKey = post.community?.accentColor ?? shareCommunity.accentColor;
  const accentColor = resolveCommunityAccentColor(accentKey, isDark);

  const openShare = (event: GestureResponderEvent) => {
    event.stopPropagation();
    if (share.sourcePostId) {
      router.push({
        params: { postId: share.sourcePostId },
        pathname: "/posts/[postId]",
      });
    } else if (communitySlug) {
      router.push({ params: { slug: communitySlug }, pathname: "/a/[slug]" });
    }
  };

  return (
    <Pressable
      accessibilityLabel={`Shared from a/${communitySlug}`}
      accessibilityRole="button"
      onPress={openShare}
      style={[
        styles.shareCard,
        { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
      ]}
    >
      <View style={[styles.shareBar, { backgroundColor: accentColor }]} />
      <View style={styles.shareBody}>
        <Text
          numberOfLines={1}
          style={[styles.shareName, { color: theme.inputText }]}
        >
          {communityName}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.shareSub, { color: theme.dividerText }]}
        >
          Shared from a/{communitySlug}
        </Text>
      </View>
      <ArrowUpRight color={theme.dividerText} size={16} />
    </Pressable>
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
  hnBy: {
    maxWidth: 70,
  },
  hnCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    overflow: "hidden",
  },
  hnChip: {
    alignItems: "center",
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  hnChipText: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
  },
  // Web's `truncate` span: the label shrinks inside its capped chip and
  // ellipsizes instead of rendering past the chip's edge.
  hnChipTruncate: {
    flexShrink: 1,
    minWidth: 0,
  },
  hnChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  hnDomain: {
    flexShrink: 0,
    marginTop: 2,
    maxWidth: "40%",
  },
  hnEyebrow: {
    fontFamily: "SofiaProBold",
    fontSize: 10,
    fontWeight: "normal",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  hnFooter: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
    paddingTop: 6,
  },
  hnFooterLink: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  hnGradient: {
    gap: 6,
    padding: 12,
  },
  hnHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  hnHeadLeft: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  hnLink: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
  },
  hnMark: {
    alignItems: "center",
    borderRadius: 6,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  hnMarkText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 10,
    fontWeight: "normal",
  },
  hnTime: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
    fontWeight: "normal",
  },
  hnTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
    lineHeight: 19,
  },
  hnTitlePress: {
    flex: 1,
    minWidth: 0,
  },
  hnTitleRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
  },
  parentAvatarPressable: {
    borderRadius: 12,
    height: 36,
    width: 36,
    zIndex: 1,
  },
  parentBody: {
    flex: 1,
    minWidth: 0,
  },
  parentContent: {
    marginTop: 4,
  },
  parentEmpty: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontStyle: "italic",
    fontWeight: "normal",
    marginTop: 4,
  },
  parentHandlePressable: {
    flexShrink: 1,
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
  parentNamePressable: {
    flexShrink: 1,
    minWidth: 0,
  },
  parentRail: {
    alignItems: "center",
    alignSelf: "stretch",
    position: "relative",
    width: 36,
  },
  parentRailLine: {
    bottom: -14,
    left: "50%",
    marginLeft: -1,
    position: "absolute",
    top: 18,
    width: 2,
    zIndex: 0,
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
    marginTop: 1,
  },
  tombstoneBody: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
  },
  tombstoneIcon: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
    zIndex: 1,
  },
  tombstoneText: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    fontStyle: "italic",
    fontWeight: "normal",
  },
});
