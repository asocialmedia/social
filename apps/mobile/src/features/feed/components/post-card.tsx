// Feed post card: 1:1 native port of web's feed PostCard
// (home/feedview/post-card.tsx). Same rows in the same order: community
// attribution, avatar rail with thread connector, header (name + badge +
// handle + relative date + more), clamped content with show more/less,
// meta chips for non-inline tags/mentions, media gallery, and the mobile
// action bar (vote | eddies | respond | views | share + bookmark).
//
// Card taps open the post detail screen (/posts/[postId]), mirroring web's
// card-wide navigation. Profile identity controls explicitly stop the press
// event before routing to /users/[username], so they never open the post.
import { useRouter } from "expo-router";
import { memo, useMemo, useState } from "react";
import type { GestureResponderEvent } from "react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import { authClient } from "@/features/auth/lib/auth-client";
import { resolveCommunityAccentColor } from "@/features/communities/lib/community-accents";
import { fetchPostDetail } from "@/features/post/lib/post-api";
import { postDetailCache, postDetailKey } from "@/features/post/lib/post-cache";
import { usePrefetchProfile } from "@/features/profile";
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
import { resolveAvatarWithFallback } from "../../home/components/profile-utils";
import { UserBadge } from "../../home/components/user-badge";
import { getPostRailColor } from "../lib/feed-rail";
import type { FeedPost } from "../lib/feed-types";
import {
  extractInlineMeta,
  formatRelativeDate,
  isBookmarkedByUser,
  getUserVote,
} from "../lib/feed-types";
import { parseStoredEmbeds } from "../lib/link-embeds";
import { buildMoreEntries } from "../lib/more-entries";
import { useVideoCaptionsStore } from "../state/video-captions-store";
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
import {
  ActivityFeedImage,
  ExplicitGate,
  MediaGallery,
  ModeratedNotice,
  useMediaActivity,
} from "./post-media";

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
  const { theme, isDark } = useAppTheme();
  const router = useRouter();
  const resolvedColor = resolveCommunityAccentColor(accentColor, isDark);
  return (
    <Pressable
      accessibilityLabel={`Community a/${slug}`}
      accessibilityRole="link"
      onPress={(event) => {
        event.stopPropagation();
        router.push({ params: { slug }, pathname: "/a/[slug]" });
      }}
      style={styles.attribution}
    >
      <View
        style={[styles.attributionBar, { backgroundColor: resolvedColor }]}
      />
      <Text
        numberOfLines={1}
        style={[styles.attributionText, { color: theme.dividerText }]}
      >
        <Text style={{ color: theme.inputText, fontFamily: "SofiaProMed" }}>
          a/{slug}
        </Text>
        {reason ? (
          <Text style={{ color: theme.dividerText, fontFamily: "SofiaProReg" }}>
            {" · "}Trending in a/{slug}
          </Text>
        ) : null}
      </Text>
    </Pressable>
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
  // Whether the card's feed/list is on screen. Backgrounded home tabs stay
  // mounted beside the active page. Undefined preserves unrestricted media
  // on detail and other surfaces that do not publish feed viewport IDs.
  active?: boolean;
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

// Memoized: lists re-render on scroll, view-count reconciles and visibility
// updates. Without memo every card re-rendered on every tick, which is the
// main scroll-jank source on long feeds.
export const PostCard = memo(
  ({
    active,
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
  }: PostCardProps) => {
    const { isDark, theme } = useAppTheme();
    const router = useRouter();
    const prefetchProfile = usePrefetchProfile();
    const [showComments, setShowComments] = useState(false);
    const [avatarFailed, setAvatarFailed] = useState(false);
    const { visible: chromeActive } = useMediaActivity(post.id);

    const apiBase = getApiBaseUrl();
    const author = post.user;
    const displayName = author?.displayName || author?.username || "unknown";
    const username = author?.username ?? "unknown";
    const authorSeed = author?.username || author?.id || null;
    const avatarUri = resolveAvatarWithFallback(
      author?.avatarUrl,
      apiBase,
      authorSeed
    );

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
      // Full id: the backend only resolves an 8-char prefix when it matches
      // exactly one post, so truncating turns colliding prefixes into 404s.
      void warmDetail();
      router.push({ params: { postId: post.id }, pathname: "/posts/[postId]" });
    };
    const warmDetail = async () => {
      const key = postDetailKey(post.id, viewerId, apiBase);
      postDetailCache.seed(key, post);
      try {
        await postDetailCache.load(key, async () => {
          const cookie = await authClient.getCookie();
          return fetchPostDetail(post.id, { apiBase, cookie });
        });
      } catch {
        // The detail screen handles request failures; the feed remains usable.
      }
    };
    const openAuthor = (event: GestureResponderEvent) => {
      event.stopPropagation();
      if (!author?.username) {
        return;
      }
      router.push({
        params: { username: author.username },
        pathname: "/users/[username]",
      });
    };

    // Warms the profile cache on touch-down so the route usually mounts with data
    // already in flight, which is what lets it paint content instead of a
    // skeleton. Cheap when the profile is cached: the hook returns immediately.
    const prefetchAuthor = () => {
      prefetchProfile(author?.username);
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
    const railColor = getPostRailColor(post, isDark);
    // Posts with no overflow entries hide the trigger instead of opening an
    // empty menu. The placeholder keeps the header row height stable so the
    // name stays top-aligned with the avatar.
    const showCaptionsForMenu = useVideoCaptionsStore(
      (state) => state.showCaptions
    );
    const hasOverflow = useMemo(
      () =>
        buildMoreEntries({
          post,
          showCaptions: showCaptionsForMenu,
          showingAlt: showAlt,
          viewerId,
        }).length > 0,
      [post, showAlt, showCaptionsForMenu, viewerId]
    );

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
        {railColor ? (
          <View
            pointerEvents="none"
            style={[styles.leftRail, { backgroundColor: railColor }]}
          />
        ) : null}
        <Pressable
          accessibilityLabel={`Open post by ${username}`}
          accessibilityRole="link"
          testID={`post-${post.id}`}
          onPress={openDetail}
          style={({ pressed }) => (pressed ? styles.cardPressed : undefined)}
        >
          {!hasThreadParent && post.parentPostId ? (
            <ResponseParentRow post={post} />
          ) : null}

          {post.community && showCommunity ? (
            <CommunityAttribution
              accentColor={post.community.accentColor}
              reason={showCommunityReason}
              slug={post.community.slug}
            />
          ) : null}

          <View style={styles.mainRow}>
            <View style={styles.rail}>
              <ThreadRail
                hasThreadChild={hasThreadChild}
                hasThreadParent={hasThreadParent}
              />
              <View
                renderToHardwareTextureAndroid={chromeActive}
                style={styles.chromeTexture}
              >
                <Pressable
                  accessibilityLabel={`Open ${author?.displayName || username}'s profile`}
                  accessibilityRole="link"
                  disabled={!author?.username}
                  onPress={openAuthor}
                  onPressIn={prefetchAuthor}
                  style={styles.avatarLink}
                >
                  <ActivityFeedImage
                    postId={post.id}
                    cachePolicy="memory-disk"
                    contentFit="cover"
                    recyclingKey={avatarUri ?? "avatar-placeholder"}
                    transition={150}
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
                </Pressable>
              </View>
            </View>

            <View style={styles.content}>
              <View
                renderToHardwareTextureAndroid={chromeActive}
                style={styles.chromeTexture}
              >
                <View style={styles.headerRow}>
                  <View style={styles.headerLeft}>
                    <Pressable
                      accessibilityLabel={`Open ${displayName}'s profile`}
                      accessibilityRole="link"
                      disabled={!author?.username}
                      onPress={openAuthor}
                      onPressIn={prefetchAuthor}
                      style={styles.authorIdentity}
                    >
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
                    </Pressable>
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
                    {hasOverflow ? (
                      <MoreButton onPress={(anchor) => onMore(post, anchor)} />
                    ) : (
                      <View
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={styles.morePlaceholder}
                      />
                    )}
                  </View>
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
                            mention.user
                              ? resolveAvatarWithFallback(
                                  mention.user.avatarUrl,
                                  apiBase,
                                  mention.user.username || mention.user.id
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
                                post={post}
                                active={active}
                                apiBase={apiBase}
                                attachments={attachments}
                                onPressMedia={openDetail}
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
                              post={post}
                              active={active}
                              apiBase={apiBase}
                              attachments={attachments}
                              onPressMedia={openDetail}
                              postId={post.id}
                            />
                          ) : null}
                          <PostLinkEmbeds
                            apiBase={apiBase}
                            embeds={linkEmbeds}
                          />
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

              <View
                renderToHardwareTextureAndroid={chromeActive}
                style={styles.chromeTexture}
              >
                <View style={styles.actions}>
                  <VoteCluster
                    aura={post.aura ?? 0}
                    authorName={displayName}
                    onRequireLogin={requireLogin}
                    postId={post.id}
                    userVote={getUserVote(post)}
                    viewerId={viewerId ?? null}
                  />
                  <CommentButton
                    count={commentCount}
                    onPress={() => setShowComments((value) => !value)}
                  />
                  <RespondButton count={responseCount} post={post} />
                  <ViewsBadge count={post.viewCount ?? 0} />
                  <View style={styles.actionCluster}>
                    <ShareButton onPress={() => onShare(post)} />
                    <BookmarkToggle
                      initialBookmarked={isBookmarkedByUser(post, viewerId)}
                      onRequireLogin={requireLogin}
                      postId={post.id}
                      viewerId={viewerId ?? null}
                    />
                  </View>
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
);
PostCard.displayName = "PostCard";

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
  authorIdentity: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 6,
    minWidth: 0,
  },
  avatar: {
    borderRadius: 12,
    height: 36,
    width: 36,
    zIndex: 1,
  },
  avatarLink: {
    height: 36,
    width: 36,
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
    position: "relative",
  },
  cardPressed: {
    opacity: 0.94,
  },
  // Cache only small static chrome, with room for the unchanged shadow bleed.
  // FlatList bounds their lifetime; images, text bodies and players stay live.
  chromeTexture: {
    margin: -4,
    padding: 4,
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
  leftRail: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
    width: 2,
    zIndex: 10,
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
  morePlaceholder: {
    height: 28,
    width: 28,
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
