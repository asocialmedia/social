// Feed post card: 1:1 native port of web's feed PostCard
// (home/feedview/post-card.tsx). Same rows in the same order: community
// attribution, avatar rail with thread connector, header (name + badge +
// handle + relative date + more), clamped content with show more/less,
// meta chips for non-inline tags/mentions, media gallery, and the mobile
// action bar (vote | eddies | respond | views | share + bookmark).
//
// Card taps open the post detail screen (/posts/[postId]), mirroring web's
// card-wide navigation (interactive controls, the composer and eddies opt
// out by sitting outside the tap region). Profile links stay static text
// and Respond shows its count without opening the skipped composer.
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import { getApiBaseUrl } from "@/lib/api-env";
import {
  AVATAR_RING_SHADOWS,
  AVATAR_RING_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

import {
  BioContent,
  MentionChip,
  TagChip,
} from "../../home/components/bio-content";
import { resolveProfileImageUrl } from "../../home/components/profile-utils";
import { UserBadge } from "../../home/components/user-badge";
import type { FeedPost } from "../lib/feed-types";
import {
  extractInlineMeta,
  formatRelativeDate,
  isBookmarkedByUser,
  getUserVote,
} from "../lib/feed-types";
import { parseStoredEmbeds } from "../lib/link-embeds";
import type { MenuAnchor } from "./more-menu";
import {
  BookmarkToggle,
  CommentButton,
  MoreButton,
  RespondButton,
  ShareButton,
  ViewsBadge,
  VoteCluster,
} from "./post-actions";
import { PostComments } from "./post-comments";
import {
  CommunityShareCard,
  HNStoryCard,
  ResponseParentRow,
} from "./post-embeds";
import { PostLinkEmbeds } from "./post-link-embeds";
import { ExplicitGate, MediaGallery, ModeratedNotice } from "./post-media";

// Content past this length collapses behind Show more, mirroring web's
// ~6-line clamp. BioContent cuts at segment boundaries so pills never split.
const CONTENT_CLAMP_LENGTH = 400;

function CommunityAttribution({
  accentColor,
  reason,
  slug,
}: {
  accentColor?: string | null;
  reason: boolean;
  slug: string;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.attribution}>
      <View
        style={[
          styles.attributionBar,
          { backgroundColor: accentColor ?? "#ff9500" },
        ]}
      />
      <Text
        numberOfLines={1}
        style={[styles.attributionText, { color: theme.dividerText }]}
      >
        a/{slug}
        {reason ? ` · Trending in a/${slug}` : ""}
      </Text>
    </View>
  );
}

function ThreadRail({
  hasThreadChild,
  hasThreadParent,
}: {
  hasThreadChild: boolean;
  hasThreadParent: boolean;
}) {
  const { theme } = useAppTheme();
  if (!hasThreadParent && !hasThreadChild) {
    return null;
  }
  const color = theme.cardBorder;
  if (hasThreadParent && hasThreadChild) {
    return (
      <View
        pointerEvents="none"
        style={[styles.railFull, { backgroundColor: color }]}
      />
    );
  }
  if (hasThreadParent) {
    return (
      <View
        pointerEvents="none"
        style={[styles.railStub, { backgroundColor: color }]}
      />
    );
  }
  return (
    <View
      pointerEvents="none"
      style={[styles.railTail, { backgroundColor: color }]}
    />
  );
}

interface PostCardProps {
  hasThreadChild: boolean;
  hasThreadParent: boolean;
  onMore: (post: FeedPost, anchor: MenuAnchor) => void;
  onOpenDetail?: (post: FeedPost) => void;
  onShare: (post: FeedPost) => void;
  post: FeedPost;
  showAlt?: boolean;
  showCommunity?: boolean;
  showCommunityReason?: boolean;
  viewerId: string | undefined;
}

export function PostCard({
  hasThreadChild,
  hasThreadParent,
  onMore,
  onOpenDetail,
  onShare,
  post,
  showAlt = false,
  showCommunity = true,
  showCommunityReason = false,
  viewerId,
}: PostCardProps) {
  const { isDark, theme } = useAppTheme();
  const router = useRouter();
  const [showComments, setShowComments] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const apiBase = getApiBaseUrl();
  const author = post.user;
  const displayName = author?.displayName || author?.username || "unknown";
  const username = author?.username ?? "unknown";
  const avatarUri = author?.avatarUrl
    ? resolveProfileImageUrl(author.avatarUrl, apiBase)
    : null;
  const viewerLoggedIn = Boolean(viewerId);

  const requireLogin = () => {
    router.push("/(auth)/login");
  };

  // Card-wide navigation, mirroring web's handleCardClick (interactive
  // targets opt out by living outside the Pressable below).
  const openDetail = () => {
    if (onOpenDetail) {
      onOpenDetail(post);
      return;
    }
    const shortId = post.id.length > 8 ? post.id.slice(0, 8) : post.id;
    router.push({ params: { postId: shortId }, pathname: "/posts/[postId]" });
  };

  const inline = useMemo(
    () => extractInlineMeta(post.content ?? ""),
    [post.content]
  );
  const extraTags = (post.tags ?? []).filter(
    (tag) => !inline.tags.has(tag.name.toLowerCase())
  );
  const extraMentions = (post.mentions ?? []).filter((mention) =>
    mention.user?.username
      ? !inline.usernames.has(mention.user.username.toLowerCase())
      : true
  );
  const hasMeta = extraTags.length > 0 || extraMentions.length > 0;
  const attachments = Array.isArray(post.attachments) ? post.attachments : [];
  // Stored link embeds (YouTube facade + OG cards) render below the media
  // in one gated column, like web's mediaAndEmbeds block.
  const linkEmbeds = useMemo(
    () => parseStoredEmbeds(post.embeds),
    [post.embeds]
  );
  const hasMediaOrEmbeds = attachments.length > 0 || linkEmbeds.length > 0;
  const commentCount = post._count?.comments ?? 0;
  const responseCount = post._count?.responses ?? 0;

  return (
    <View
      style={[
        styles.card,
        {
          paddingBottom: hasThreadChild ? 8 : 16,
          paddingTop: hasThreadParent ? 8 : 16,
        },
      ]}
    >
      <Pressable
        accessibilityLabel={`Open post by ${username}`}
        accessibilityRole="link"
        onPress={openDetail}
      >
        {post.community && showCommunity ? (
          <CommunityAttribution
            accentColor={post.community.accentColor}
            reason={showCommunityReason}
            slug={post.community.slug}
          />
        ) : null}

        {!hasThreadParent && post.parentPostId ? (
          <ResponseParentRow post={post} />
        ) : null}

        <View style={styles.mainRow}>
          <View style={styles.rail}>
            <ThreadRail
              hasThreadChild={hasThreadChild}
              hasThreadParent={hasThreadParent}
            />
            <Image
              contentFit="cover"
              onError={() => setAvatarFailed(true)}
              source={
                avatarUri && !avatarFailed
                  ? { uri: avatarUri }
                  : avatarPlaceholder
              }
              style={[styles.avatar, { backgroundColor: theme.cardBg }]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.avatarRing,
                {
                  boxShadow: isDark
                    ? AVATAR_RING_SHADOWS_DARK
                    : AVATAR_RING_SHADOWS,
                },
              ]}
            />
          </View>

          <View style={styles.content}>
            <View style={styles.headerRow}>
              <View style={styles.headerLeft}>
                <Text
                  numberOfLines={1}
                  style={[styles.name, { color: theme.inputText }]}
                >
                  {displayName}
                </Text>
                <UserBadge
                  badge={author?.badge}
                  badges={author?.badges}
                  communityRoles={author?.communityMemberships}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.handle, { color: theme.dividerText }]}
                >
                  @{username}
                </Text>
                <Text style={[styles.dot, { color: theme.dividerText }]}>
                  ·
                </Text>
                <Text style={[styles.date, { color: theme.dividerText }]}>
                  {formatRelativeDate(post.createdAt)}
                </Text>
              </View>
              {/* Web's header buttons carry -my-1 so the text row sets the row
                height and the name stays top-aligned with the avatar. */}
              <View style={styles.moreFix}>
                <MoreButton onPress={(anchor) => onMore(post, anchor)} />
              </View>
            </View>

            {post.moderated ? (
              <ModeratedNotice />
            ) : (
              <>
                {post.content ? (
                  <View style={styles.body}>
                    <BioContent
                      apiBase={apiBase}
                      bio={post.content}
                      clampLength={CONTENT_CLAMP_LENGTH}
                    />
                  </View>
                ) : null}

                {hasMeta ? (
                  <View style={styles.meta}>
                    {extraTags.map((tag) => (
                      <TagChip key={tag.id} tag={tag.name} />
                    ))}
                    {extraMentions.map((mention, index) => (
                      <MentionChip
                        avatarUrl={
                          mention.user?.avatarUrl
                            ? resolveProfileImageUrl(
                                mention.user.avatarUrl,
                                apiBase
                              )
                            : null
                        }
                        key={mention.user?.id ?? index}
                        username={mention.user?.username ?? "unknown"}
                      />
                    ))}
                  </View>
                ) : null}

                {post.hnStoryShare ? <HNStoryCard post={post} /> : null}
                {post.communityShare ? (
                  <CommunityShareCard post={post} />
                ) : null}

                {hasMediaOrEmbeds ? (
                  <View
                    style={[
                      styles.media,
                      // Web's media rule: a roomier top gap only when the post
                      // opens straight into attachment media.
                      { marginTop: post.content?.trim() ? 10 : 14 },
                    ]}
                  >
                    {post.explicitContent ? (
                      <ExplicitGate
                        apiBase={apiBase}
                        attachments={attachments}
                        revealKey={post.id}
                      >
                        <View style={styles.mediaColumn}>
                          {attachments.length > 0 ? (
                            <MediaGallery
                              apiBase={apiBase}
                              attachments={attachments}
                              postId={post.id}
                            />
                          ) : null}
                          <PostLinkEmbeds
                            apiBase={apiBase}
                            embeds={linkEmbeds}
                          />
                        </View>
                      </ExplicitGate>
                    ) : (
                      <View style={styles.mediaColumn}>
                        {attachments.length > 0 ? (
                          <MediaGallery
                            apiBase={apiBase}
                            attachments={attachments}
                            postId={post.id}
                          />
                        ) : null}
                        <PostLinkEmbeds apiBase={apiBase} embeds={linkEmbeds} />
                      </View>
                    )}
                    {showAlt
                      ? attachments
                          .filter((media) => media.altText)
                          .map((media) => (
                            <Text
                              key={media.id}
                              style={[
                                styles.altText,
                                { color: theme.dividerText },
                              ]}
                            >
                              ALT: {media.altText}
                            </Text>
                          ))
                      : null}
                  </View>
                ) : null}
              </>
            )}

            <View style={styles.actions}>
              <VoteCluster
                aura={post.aura ?? 0}
                onRequireLogin={requireLogin}
                postId={post.id}
                userVote={getUserVote(post)}
                viewerLoggedIn={viewerLoggedIn}
              />
              <CommentButton
                count={commentCount}
                onPress={() => setShowComments((value) => !value)}
              />
              <RespondButton count={responseCount} />
              <ViewsBadge count={post.viewCount ?? 0} />
              <View style={styles.actionCluster}>
                <ShareButton onPress={() => onShare(post)} />
                <BookmarkToggle
                  initialBookmarked={isBookmarkedByUser(post, viewerId)}
                  onRequireLogin={requireLogin}
                  postId={post.id}
                  viewerLoggedIn={viewerLoggedIn}
                />
              </View>
            </View>
          </View>
        </View>
      </Pressable>

      {/* Eddies own the full card width below the body (web's FeedComments
          sits outside the padded content column, not indented by the rail). */}
      {showComments ? (
        <PostComments
          postId={post.id}
          tight={hasThreadChild}
          viewerId={viewerId}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actionCluster: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    width: "100%",
  },
  altText: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    marginTop: 6,
  },
  attribution: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  attributionBar: {
    borderRadius: 9999,
    height: 14,
    width: 2,
  },
  attributionText: {
    flex: 1,
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
    minWidth: 0,
  },
  avatar: {
    borderRadius: 12,
    height: 36,
    width: 36,
    zIndex: 1,
  },
  avatarRing: {
    borderRadius: 12,
    bottom: 0,
    height: 36,
    left: 0,
    position: "absolute",
    top: 0,
    width: 36,
  },
  body: {
    marginTop: 4,
  },
  card: {
    paddingHorizontal: 16,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  date: {
    flexShrink: 0,
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
  },
  dot: {
    flexShrink: 0,
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
  },
  handle: {
    flexShrink: 1,
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    minWidth: 0,
  },
  headerLeft: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 6,
    minWidth: 0,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  mainRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
  },
  media: {
    marginTop: 10,
  },
  mediaColumn: {
    gap: 10,
  },
  meta: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
  },
  moreFix: {
    marginVertical: -4,
  },
  name: {
    flexShrink: 1,
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
    minWidth: 0,
  },
  rail: {
    alignItems: "center",
    alignSelf: "stretch",
    position: "relative",
    width: 36,
  },
  railFull: {
    bottom: -9,
    left: "50%",
    marginLeft: -1,
    position: "absolute",
    top: -9,
    width: 2,
  },
  railStub: {
    height: 27,
    left: "50%",
    marginLeft: -1,
    position: "absolute",
    top: -9,
    width: 2,
  },
  railTail: {
    bottom: -9,
    left: "50%",
    marginLeft: -1,
    position: "absolute",
    top: 18,
    width: 2,
  },
});
