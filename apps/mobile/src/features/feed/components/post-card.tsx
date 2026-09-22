// Feed post card: 1:1 native port of web's feed PostCard
// (home/feedview/post-card.tsx). Same rows in the same order: community
// attribution, avatar rail with thread connector, header (name + badge +
// handle + relative date + more), clamped content with show more/less,
// meta chips for non-inline tags/mentions, media gallery, and the mobile
// action bar (vote | eddies | respond | views | share + bookmark).
//
// Deliberate deltas: the whole card is not tappable (no post detail screen
// exists on mobile yet), profile links are static text, and Respond shows
// its count without opening the skipped composer.
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

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
import { MediaGallery, ModeratedNotice } from "./post-media";

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
  onMore: (post: FeedPost) => void;
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
              <Text style={[styles.dot, { color: theme.dividerText }]}>·</Text>
              <Text style={[styles.date, { color: theme.dividerText }]}>
                {formatRelativeDate(post.createdAt)}
              </Text>
            </View>
            <MoreButton onPress={() => onMore(post)} />
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
              {post.communityShare ? <CommunityShareCard post={post} /> : null}

              {attachments.length > 0 ? (
                <View style={styles.media}>
                  <MediaGallery
                    apiBase={apiBase}
                    attachments={attachments}
                    explicitContent={post.explicitContent}
                  />
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

          {showComments ? (
            <PostComments postId={post.id} viewerId={viewerId} />
          ) : null}
        </View>
      </View>
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
  meta: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
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
