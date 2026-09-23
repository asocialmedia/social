// Detail variant of the feed PostCard: native port of web PostCard with
// detail=true (mobile action bar). Lives here instead of post-card.tsx so the
// home feed files stay untouched for the parallel visual-quirks pass.
// Same rows, detail arrangement: community attribution, big two-row header
// (40px avatar, name + badge + date / handle), expanded content, meta chips,
// media column behind the explicit gate, and the mobile action bar.
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import {
  BookmarkToggle,
  CommentButton,
  MoreButton,
  RespondButton,
  ShareButton,
  ViewsBadge,
  VoteCluster,
} from "@/features/feed/components/post-actions";
import {
  CommunityShareCard,
  HNStoryCard,
  ResponseParentRow,
} from "@/features/feed/components/post-embeds";
import { PostLinkEmbeds } from "@/features/feed/components/post-link-embeds";
import {
  ExplicitGate,
  MediaGallery,
  ModeratedNotice,
} from "@/features/feed/components/post-media";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import {
  extractInlineMeta,
  formatRelativeDate,
  isBookmarkedByUser,
  getUserVote,
} from "@/features/feed/lib/feed-types";
import { parseStoredEmbeds } from "@/features/feed/lib/link-embeds";
import {
  BioContent,
  MentionChip,
  TagChip,
} from "@/features/home/components/bio-content";
import { resolveProfileImageUrl } from "@/features/home/components/profile-utils";
import { UserBadge } from "@/features/home/components/user-badge";
import { getApiBaseUrl } from "@/lib/api-env";
import {
  AVATAR_RING_SHADOWS,
  AVATAR_RING_SHADOWS_DARK,
  useAppTheme,
} from "@/theme";

interface PostDetailCardProps {
  hasThreadParent?: boolean;
  // Web parity (isJoined switches Card vs plain div on web); native
  // renders one surface either way.
  joined?: boolean;
  onMore: (post: FeedPost) => void;
  onOpenMedia: (index: number) => void;
  onShare: (post: FeedPost) => void;
  onToggleEddies: () => void;
  post: FeedPost;
  showAlt?: boolean;
  viewerId: string | undefined;
}

export function PostDetailCard({
  hasThreadParent = false,
  onMore,
  onOpenMedia,
  onShare,
  onToggleEddies,
  post,
  showAlt = false,
  viewerId,
}: PostDetailCardProps) {
  const { isDark, theme } = useAppTheme();
  const router = useRouter();
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
          paddingBottom: 16,
          paddingTop: hasThreadParent ? 8 : 16,
        },
      ]}
    >
      {post.community ? (
        <View style={styles.attribution}>
          <View
            style={[
              styles.attributionBar,
              { backgroundColor: post.community.accentColor ?? "#ff9500" },
            ]}
          />
          <Text
            numberOfLines={1}
            style={[styles.attributionText, { color: theme.dividerText }]}
          >
            a/{post.community.slug}
          </Text>
        </View>
      ) : null}

      {!hasThreadParent && post.parentPostId ? (
        <ResponseParentRow post={post} />
      ) : null}

      {hasThreadParent ? (
        <View style={styles.mainRow}>
          <View style={styles.rail}>
            <View
              pointerEvents="none"
              style={[styles.railStub, { backgroundColor: theme.cardBorder }]}
            />
            <Image
              contentFit="cover"
              onError={() => setAvatarFailed(true)}
              source={
                avatarUri && !avatarFailed
                  ? { uri: avatarUri }
                  : avatarPlaceholder
              }
              style={[styles.avatarSmall, { backgroundColor: theme.cardBg }]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.avatarRingSmall,
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
              <View style={styles.moreFix}>
                <MoreButton onPress={() => onMore(post)} />
              </View>
            </View>
            <DetailBody
              apiBase={apiBase}
              attachments={attachments}
              commentCount={commentCount}
              extraMentions={extraMentions}
              extraTags={extraTags}
              hasMediaOrEmbeds={hasMediaOrEmbeds}
              hasMeta={hasMeta}
              linkEmbeds={linkEmbeds}
              onOpenMedia={onOpenMedia}
              onShare={onShare}
              onToggleEddies={onToggleEddies}
              post={post}
              requireLogin={requireLogin}
              responseCount={responseCount}
              showAlt={showAlt}
              viewerId={viewerId}
              viewerLoggedIn={viewerLoggedIn}
            />
          </View>
        </View>
      ) : (
        <View>
          <View style={styles.detailHead}>
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
            <View style={styles.detailTitles}>
              <View style={styles.detailNameRow}>
                <Text
                  numberOfLines={1}
                  style={[styles.detailName, { color: theme.inputText }]}
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
                  style={[styles.detailDate, { color: theme.dividerText }]}
                >
                  {formatRelativeDate(post.createdAt)}
                </Text>
              </View>
              <Text
                numberOfLines={1}
                style={[styles.detailHandle, { color: theme.dividerText }]}
              >
                @{username}
              </Text>
            </View>
            <View style={styles.detailMore}>
              <MoreButton onPress={() => onMore(post)} />
              <BookmarkToggle
                initialBookmarked={isBookmarkedByUser(post, viewerId)}
                onRequireLogin={requireLogin}
                postId={post.id}
                viewerLoggedIn={viewerLoggedIn}
              />
            </View>
          </View>
          <View style={styles.detailContent}>
            <DetailBody
              apiBase={apiBase}
              attachments={attachments}
              commentCount={commentCount}
              extraMentions={extraMentions}
              extraTags={extraTags}
              hasMediaOrEmbeds={hasMediaOrEmbeds}
              hasMeta={hasMeta}
              linkEmbeds={linkEmbeds}
              onOpenMedia={onOpenMedia}
              onShare={onShare}
              onToggleEddies={onToggleEddies}
              post={post}
              requireLogin={requireLogin}
              responseCount={responseCount}
              showAlt={showAlt}
              viewerId={viewerId}
              viewerLoggedIn={viewerLoggedIn}
              hideBookmark
            />
          </View>
        </View>
      )}
    </View>
  );
}

function DetailBody({
  apiBase,
  attachments,
  commentCount,
  extraMentions,
  extraTags,
  hasMediaOrEmbeds,
  hasMeta,
  hideBookmark = false,
  linkEmbeds,
  onOpenMedia,
  onShare,
  onToggleEddies,
  post,
  requireLogin,
  responseCount,
  showAlt,
  viewerId,
  viewerLoggedIn,
}: {
  apiBase: string;
  attachments: FeedPost["attachments"] & object;
  commentCount: number;
  extraMentions: NonNullable<FeedPost["mentions"]>;
  extraTags: NonNullable<FeedPost["tags"]>;
  hasMediaOrEmbeds: boolean;
  hasMeta: boolean;
  hideBookmark?: boolean;
  linkEmbeds: ReturnType<typeof parseStoredEmbeds>;
  onOpenMedia: (index: number) => void;
  onShare: (post: FeedPost) => void;
  onToggleEddies: () => void;
  post: FeedPost;
  requireLogin: () => void;
  responseCount: number;
  showAlt: boolean;
  viewerId: string | undefined;
  viewerLoggedIn: boolean;
}) {
  const { theme } = useAppTheme();
  const list = Array.isArray(attachments) ? attachments : [];
  return (
    <View>
      {post.moderated ? (
        <ModeratedNotice />
      ) : (
        <>
          {post.content ? (
            <View style={styles.body}>
              <BioContent apiBase={apiBase} bio={post.content} />
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
                      ? resolveProfileImageUrl(mention.user.avatarUrl, apiBase)
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

          {hasMediaOrEmbeds ? (
            <View
              style={[
                styles.media,
                { marginTop: post.content?.trim() ? 10 : 14 },
              ]}
            >
              {post.explicitContent ? (
                <ExplicitGate
                  apiBase={apiBase}
                  attachments={list}
                  revealKey={post.id}
                >
                  <View style={styles.mediaColumn}>
                    {list.length > 0 ? (
                      <MediaGallery
                        apiBase={apiBase}
                        attachments={list}
                        onPressMedia={onOpenMedia}
                        postId={post.id}
                      />
                    ) : null}
                    <PostLinkEmbeds apiBase={apiBase} embeds={linkEmbeds} />
                  </View>
                </ExplicitGate>
              ) : (
                <View style={styles.mediaColumn}>
                  {list.length > 0 ? (
                    <MediaGallery
                      apiBase={apiBase}
                      attachments={list}
                      onPressMedia={onOpenMedia}
                      postId={post.id}
                    />
                  ) : null}
                  <PostLinkEmbeds apiBase={apiBase} embeds={linkEmbeds} />
                </View>
              )}
              {showAlt
                ? list
                    .filter((media) => media.altText)
                    .map((media) => (
                      <Text
                        key={media.id}
                        style={[styles.altText, { color: theme.dividerText }]}
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
        <CommentButton count={commentCount} onPress={onToggleEddies} />
        <RespondButton count={responseCount} />
        <ViewsBadge count={post.viewCount ?? 0} />
        <View style={styles.actionCluster}>
          <ShareButton onPress={() => onShare(post)} />
          {hideBookmark ? null : (
            <BookmarkToggle
              initialBookmarked={isBookmarkedByUser(post, viewerId)}
              onRequireLogin={requireLogin}
              postId={post.id}
              viewerLoggedIn={viewerLoggedIn}
            />
          )}
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
    height: 40,
    width: 40,
    zIndex: 1,
  },
  avatarRing: {
    borderRadius: 12,
    bottom: 0,
    height: 40,
    left: 0,
    position: "absolute",
    top: 0,
    width: 40,
  },
  avatarRingSmall: {
    borderRadius: 12,
    height: 36,
    left: 0,
    position: "absolute",
    top: 0,
    width: 36,
  },
  avatarSmall: {
    borderRadius: 12,
    height: 36,
    width: 36,
    zIndex: 1,
  },
  body: {
    marginTop: 12,
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
  detailContent: {
    marginTop: 0,
  },
  detailDate: {
    flexShrink: 0,
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
  },
  detailHandle: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    fontWeight: "normal",
    marginTop: 2,
  },
  detailHead: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    position: "relative",
  },
  detailMore: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    position: "absolute",
    right: 0,
    top: 0,
  },
  detailName: {
    flexShrink: 1,
    fontFamily: "SofiaProBold",
    fontSize: 15,
    fontWeight: "normal",
    minWidth: 0,
  },
  detailNameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  detailTitles: {
    flex: 1,
    minWidth: 0,
    paddingRight: 76,
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
  railStub: {
    height: 27,
    left: "50%",
    marginLeft: -1,
    position: "absolute",
    top: -9,
    width: 2,
  },
});
