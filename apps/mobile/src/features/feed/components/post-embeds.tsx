// Quoted-content cards for the feed: the response parent row, the Hacker
// News story card, and the community share card. Ports of web's
// ResponseParentRow, HNStoryCard and CommunityShareCard (post-card.tsx).
import type { ExternalPost } from "@asm/protocols/contracts";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  ArrowUpRight,
  ImageOff,
  Link2,
  MessageCircle,
  ThumbsUp,
  User,
  X,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { GestureResponderEvent } from "react-native";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { CommunityAvatar } from "@/features/communities/components/community-avatar";
import { resolveCommunityAccentColor } from "@/features/communities/lib/community-accents";
import { ConcealedMediaCover } from "@/features/feed/components/concealed-media-cover";
import { UserBadge } from "@/features/home/components/user-badge";
import { openExternalUrl as openUrlSafely } from "@/lib/interaction/open-url";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { SURFACE_SHADOWS, SURFACE_SHADOWS_DARK, useAppTheme } from "@/theme";

import { BioContent } from "../../home/components/bio-content";
import { safeLinkUrl } from "../../home/components/profile-utils";
import { externalPostView } from "../lib/external-post-view";
import { resolveResponseCommunityAccent } from "../lib/feed-rail";
import { formatRelativeDate } from "../lib/feed-types";
import type { FeedPost } from "../lib/feed-types";
import { parseStoredEmbeds } from "../lib/link-embeds";
import { mediaImageUrl, mediaPosterUrl } from "../lib/media-url";
import { BlueskyIcon } from "./bluesky-icon";
import { CommunityAttribution } from "./community-attribution";
import { ExternalResponseParent } from "./external-response-parent";
import { PostLinkEmbeds } from "./post-link-embeds";

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

// `externalSource` is the Bluesky post an ASM response replies to, once
// ExternalResponseParent has read it; web renders that through this same row
// (ExternalResponseParentRow), so both sources look identical. `null` means the
// read finished and the source is gone.
export function ResponseParentRow({
  post,
  externalSource,
}: {
  post: FeedPost;
  externalSource?: ExternalPost | null;
}) {
  const { theme, isDark } = useAppTheme();
  const router = useRouter();
  const apiBase = getApiBaseUrl();
  const external = externalSource ?? post.external?.quote;
  const parent = external ? externalPostView(external) : post.parentPost;
  const [natural, setNatural] = useState<{
    width: number;
    height: number;
  } | null>(null);

  if (post.externalParent && !external && externalSource === undefined) {
    return <ExternalResponseParent post={post} />;
  }

  const sourceUri = post.externalParent?.uri;
  if ((post.parentPostId || sourceUri) && !parent) {
    // Web's tombstone: a muted ImageOff tile on the rail and a surface-3d note.
    const openOriginal = () => {
      if (sourceUri) {
        router.push({ params: { uri: sourceUri }, pathname: "/external-post" });
      } else if (post.parentPostId) {
        router.push({
          params: { postId: post.parentPostId },
          pathname: "/posts/[postId]",
        });
      }
    };
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
              { backgroundColor: isDark ? "#262626" : "#f0f0f0" },
            ]}
          >
            <ImageOff color={theme.dividerText} size={16} />
          </View>
        </View>
        <View
          style={[
            styles.tombstoneBody,
            {
              backgroundColor: theme.cardBg,
              borderColor: theme.cardBorder,
              boxShadow: isDark ? SURFACE_SHADOWS_DARK : SURFACE_SHADOWS,
            },
          ]}
        >
          <Text style={[styles.tombstoneTitle, { color: theme.inputText }]}>
            This post is unavailable
          </Text>
          <Text style={[styles.tombstoneText, { color: theme.dividerText }]}>
            The original may have been removed or made private. This response is
            still available.
          </Text>
          <Pressable
            accessibilityRole="link"
            hitSlop={6}
            onPress={openOriginal}
          >
            <Text style={styles.tombstoneLink}>Check original post</Text>
          </Pressable>
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
  const width = natural?.width ?? firstMedia?.width ?? 0;
  const height = natural?.height ?? firstMedia?.height ?? 0;
  const ratio = width > 0 && height > 0 ? width / height : 1;
  const parentPostId = parent.id || post.parentPostId;
  const embeds = parseStoredEmbeds(parent.embeds);

  const openParentPost = (event: GestureResponderEvent) => {
    event.stopPropagation();
    if (!parentPostId) {
      return;
    }
    if (external) {
      router.push({ params: { uri: external.id }, pathname: "/external-post" });
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
    if (external) {
      router.push({
        params: { actor: external.author.id },
        pathname: "/external-profile",
      });
      return;
    }
    router.push({
      params: { username },
      pathname: "/users/[username]",
    });
  };

  return (
    <View
      testID={`response-source-${parentPostId}`}
      style={styles.parentSource}
    >
      {parent.community ? (
        <View
          pointerEvents="none"
          testID="response-source-community-rail"
          style={[
            styles.parentCommunityRail,
            {
              backgroundColor: resolveCommunityAccentColor(
                resolveResponseCommunityAccent(parent),
                isDark
              ),
            },
          ]}
        />
      ) : null}
      {parent.community ? (
        <CommunityAttribution
          accentColor={resolveResponseCommunityAccent(parent)}
          id={parent.community.id}
          name={parent.community.name}
          reason={false}
          slug={parent.community.slug}
        />
      ) : null}
      <View style={styles.parentRow}>
        <View style={styles.parentRail}>
          <View
            style={[
              styles.parentRailLine,
              { backgroundColor: theme.cardBorder },
            ]}
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
            {external ? (
              <BlueskyIcon />
            ) : (
              <UserBadge
                badge={parent.user?.badge}
                badges={parent.user?.badges}
                communityRoles={parent.user?.communityMemberships}
              />
            )}
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
                sourceSegments={external?.segments}
              />
            </View>
          ) : null}
          {firstMedia && firstMedia.type !== "AUDIO" ? (
            <View
              style={[
                styles.parentThumb,
                { aspectRatio: ratio },
                ratio <= 1
                  ? { alignSelf: "flex-start", height: 320, maxWidth: "100%" }
                  : { maxHeight: 320, width: "100%" },
              ]}
            >
              {parent.explicitContent ? (
                <ConcealedMediaCover
                  accessibilityLabel="Blurred explicit media preview"
                  apiBase={apiBase}
                  media={firstMedia}
                />
              ) : (
                <Image
                  contentFit="contain"
                  accessibilityLabel="Parent post media"
                  source={{
                    uri:
                      firstMedia.type === "VIDEO"
                        ? mediaPosterUrl(
                            apiBase,
                            firstMedia.id,
                            firstMedia.thumbnailKey
                          )
                        : mediaImageUrl(apiBase, firstMedia),
                  }}
                  onLoad={(event) => {
                    if (event.source.width > 0 && event.source.height > 0) {
                      setNatural({
                        height: event.source.height,
                        width: event.source.width,
                      });
                    }
                  }}
                  style={StyleSheet.absoluteFill}
                />
              )}
            </View>
          ) : null}
          {embeds.length > 0 && !parent.explicitContent ? (
            <PostLinkEmbeds apiBase={apiBase} embeds={embeds} />
          ) : null}
          {!parent.content && !firstMedia && embeds.length === 0 ? (
            <Text style={[styles.parentEmpty, { color: theme.dividerText }]}>
              Post
            </Text>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

// Compact embed of the post a response replies to, sitting above the reply.
// Port of web's default ResponseParentCard: tonal elevation (surface +
// self-colored edge) rather than an accent bar. Avatar + name + handle + date
// row, then an optional 48px thumb beside 2-line clamped content.
export function ResponseParentCard({ post }: { post: FeedPost }) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const apiBase = getApiBaseUrl();
  const parent = post.parentPost;
  const { parentPostId } = post;

  const openParent = () => {
    if (!parentPostId) {
      return;
    }
    router.push({
      params: { postId: parentPostId },
      pathname: "/posts/[postId]",
    });
  };

  if (!parent) {
    return (
      <View
        style={[
          styles.compactCard,
          { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
        ]}
      >
        <View style={styles.compactTombRow}>
          <ImageOff color={theme.dividerText} size={14} />
          <View style={styles.compactTombCopy}>
            <Text style={[styles.compactName, { color: theme.dividerText }]}>
              This post is unavailable
            </Text>
            <Text style={[styles.compactBody, { color: theme.dividerText }]}>
              The original may have been removed or made private.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  const username = parent.user?.username ?? "unknown";
  const displayName = parent.user?.displayName || username;
  const media = (parent.attachments ?? [])[0] ?? null;
  let thumbUri: string | null = null;
  if (media && media.type !== "AUDIO") {
    thumbUri =
      media.type === "VIDEO"
        ? mediaPosterUrl(apiBase, media.id, media.thumbnailKey)
        : mediaImageUrl(apiBase, media);
  }

  return (
    <Pressable
      accessibilityLabel={`In reply to ${displayName}`}
      accessibilityRole="link"
      onPress={openParent}
      style={[
        styles.compactCard,
        { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
      ]}
    >
      <View style={styles.compactHead}>
        <UserAvatar
          size={20}
          url={parent.user?.avatarUrl ?? null}
          userId={parent.user?.id ?? null}
          username={parent.user?.username ?? null}
        />
        <Text
          numberOfLines={1}
          style={[styles.compactName, { color: theme.inputText }]}
        >
          {displayName}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.compactMeta, { color: theme.dividerText }]}
        >
          @{username}
        </Text>
        <Text style={[styles.compactMeta, { color: theme.dividerText }]}>
          ·
        </Text>
        <Text style={[styles.compactMeta, { color: theme.dividerText }]}>
          {formatRelativeDate(parent.createdAt)}
        </Text>
      </View>
      <View style={styles.compactBodyRow}>
        {thumbUri ? (
          <View style={styles.compactThumb}>
            <Image
              accessibilityLabel=""
              contentFit="cover"
              source={{ uri: thumbUri }}
              style={StyleSheet.absoluteFill}
            />
            {parent.isGust ? (
              <View style={styles.compactGust}>
                <Text style={styles.compactGustText}>Gust</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {parent.content ? (
          <Text
            numberOfLines={2}
            style={[styles.compactBody, { color: theme.dividerText }]}
          >
            {parent.content}
          </Text>
        ) : null}
        {!parent.content && !thumbUri ? (
          <Text style={[styles.compactBody, { color: theme.dividerText }]}>
            Media post
          </Text>
        ) : null}
      </View>
    </Pressable>
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
    void openUrlSafely(safe);
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
export function HNStoryCard({
  post,
  onRemove,
}: {
  post: Pick<FeedPost, "hnStoryShare">;
  onRemove?: () => void;
}) {
  const { isDark, theme } = useAppTheme();
  const story = post.hnStoryShare;
  if (!story) {
    return null;
  }
  const accent = isDark ? "#fdba74" : "#c2410c";
  const domain = hnDomain(story.url);
  const storyUrl =
    story.url ||
    (story.storyId
      ? `https://news.ycombinator.com/item?id=${story.storyId}`
      : undefined);
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
          {onRemove ? (
            <Pressable
              accessibilityLabel="Remove Hacker News story"
              accessibilityRole="button"
              onPress={onRemove}
              hitSlop={6}
              style={styles.hnRemove}
            >
              <X color={theme.dividerText} size={16} />
            </Pressable>
          ) : (
            <Text style={[styles.hnTime, { color: theme.dividerText }]}>
              {hnTimeAgo(story.time)}
            </Text>
          )}
        </View>
        <View
          style={[
            styles.hnTitleRow,
            onRemove ? { flexDirection: "column", gap: 6 } : null,
          ]}
        >
          <Pressable
            onPress={() => openExternalUrl(storyUrl)}
            style={[
              styles.hnTitlePress,
              onRemove ? { flex: 0, width: "100%" } : null,
            ]}
          >
            <Text
              numberOfLines={onRemove ? undefined : 2}
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
                onRemove ? { alignSelf: "flex-start", maxWidth: "100%" } : null,
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
            onPress={() => openExternalUrl(storyUrl)}
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

export function CommunityShareCard({
  post,
}: {
  post: Pick<FeedPost, "community" | "communityShare">;
}) {
  const { theme } = useAppTheme();
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
      accessibilityLabel={`Shared via a/${communitySlug}`}
      accessibilityRole="button"
      onPress={openShare}
      style={[
        styles.shareCard,
        { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
      ]}
    >
      <CommunityAvatar
        community={{
          accentColor: accentKey ?? null,
          avatarUrl: `${getApiBaseUrl()}/api/communities/avatar/${encodeURIComponent(shareCommunity.id)}/image`,
          name: communityName,
          slug: communitySlug,
        }}
        size={32}
      />
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
          Shared via a/{communitySlug}
        </Text>
      </View>
      <ArrowUpRight color={theme.dividerText} size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compactBody: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    lineHeight: 17,
    minWidth: 0,
  },
  compactBodyRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  compactCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  compactGust: {
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
  },
  compactGustText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 9,
    fontWeight: "normal",
    textAlign: "center",
  },
  compactHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  compactMeta: {
    flexShrink: 0,
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
  },
  compactName: {
    flexShrink: 1,
    fontFamily: "SofiaProBold",
    fontSize: 12,
    fontWeight: "normal",
  },
  compactThumb: {
    borderRadius: 8,
    flexShrink: 0,
    height: 48,
    overflow: "hidden",
    position: "relative",
    width: 48,
  },
  compactTombCopy: {
    flex: 1,
    minWidth: 0,
  },
  compactTombRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
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
  hnRemove: {
    alignItems: "center",
    borderRadius: 9999,
    height: 28,
    justifyContent: "center",
    width: 28,
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
  parentCommunityRail: {
    bottom: 12,
    left: -16,
    position: "absolute",
    top: 0,
    width: 2,
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
  parentSource: {
    position: "relative",
  },
  parentThumb: {
    borderRadius: 12,
    marginTop: 8,
    overflow: "hidden",
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
  // `surface-3d mb-3 rounded-xl px-3 py-2.5`.
  tombstoneBody: {
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    marginBottom: 12,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tombstoneIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 36,
    justifyContent: "center",
    width: 36,
    zIndex: 1,
  },
  tombstoneLink: {
    color: "#f66b15",
    fontFamily: "SofiaProMed",
    fontSize: 12,
    marginTop: 8,
  },
  tombstoneText: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    marginTop: 4,
  },
  tombstoneTitle: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
});
