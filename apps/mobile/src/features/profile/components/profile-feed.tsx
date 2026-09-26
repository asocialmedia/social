import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Clapperboard, Eye, Flame } from "lucide-react-native";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";

import noMediaImage from "@/assets/images/nomedia.png";
import { UserAvatar } from "@/components/avatar/user-avatar";
import { Spinner3D } from "@/components/feedback/spinner-3d";
import { toast } from "@/components/feedback/toast";
import {
  MoreMenu,
  buildMoreEntries,
} from "@/features/feed/components/more-menu";
import type {
  MenuAnchor,
  MoreAction,
  MoreMenuEntry,
} from "@/features/feed/components/more-menu";
import { PostCard } from "@/features/feed/components/post-card";
import {
  ShareSheet,
  getSharePostUrl,
} from "@/features/feed/components/share-sheet";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import {
  isAudioMedia,
  isVideoMedia,
  mediaImageUrl,
  mediaPosterUrl,
} from "@/features/feed/lib/media-url";
import { BioContent } from "@/features/home/components/bio-content";
import { getAuraFlameStyle } from "@/features/home/components/profile-utils";
import { UserBadge } from "@/features/home/components/user-badge";
import { getApiBaseUrl } from "@/lib/api-env";
import { formatNumber } from "@/lib/format-number";
import { useAppTheme } from "@/theme";

import type { ProfileViewTab } from "../lib/profile-tab-memory";
import type {
  ProfileFeedView,
  ProfileMedia,
  ProfileReply,
} from "../lib/profile-view-model";
import { mediaTileAspect } from "../lib/profile-view-model";

type ProfileFeedItem =
  | { kind: "post"; value: FeedPost }
  | { kind: "media"; value: ProfileMedia }
  | { kind: "reply"; value: ProfileReply };

function isMediaFeed(
  feed: ProfileFeedView
): feed is Extract<ProfileFeedView, { kind: "media" }> {
  return feed.kind === "media";
}

function isReplyFeed(
  feed: ProfileFeedView
): feed is Extract<ProfileFeedView, { kind: "replies" }> {
  return feed.kind === "replies";
}

function feedItems(feed: ProfileFeedView): ProfileFeedItem[] {
  if (isMediaFeed(feed)) {
    return feed.media.map((value) => ({ kind: "media", value }));
  }
  if (isReplyFeed(feed)) {
    return feed.replies.map((value) => ({ kind: "reply", value }));
  }
  return feed.posts.map((value) => ({ kind: "post", value }));
}

function openPostRoute(
  router: ReturnType<typeof useRouter>,
  postId: string
): void {
  const shortId = postId.length > 8 ? postId.slice(0, 8) : postId;
  router.push({ params: { postId: shortId }, pathname: "/posts/[postId]" });
}

function ProfileTabState({
  feed,
  onRetry,
}: {
  feed: ProfileFeedView;
  onRetry: () => void;
}) {
  const { theme } = useAppTheme();
  if (feed.status === "loading" || feed.status === "idle") {
    return (
      <View style={styles.loading}>
        <Spinner3D size={48} />
        <Text style={[styles.loadingText, { color: theme.dividerText }]}>
          Loading profile…
        </Text>
      </View>
    );
  }
  if (feed.status === "error") {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
          Couldn't load this tab
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={[
            styles.retry,
            { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
          ]}
        >
          <Text style={{ color: theme.inputText }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  return null;
}

function EmptyProfileTab({ tab }: { tab: ProfileViewTab }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.empty}>
      <Image
        contentFit="contain"
        source={noMediaImage}
        style={styles.emptyImage}
      />
      <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
        {tab === "media" ? "No media yet" : `No ${tab} yet`}
      </Text>
      <Text style={[styles.emptyCopy, { color: theme.dividerText }]}>
        {tab === "media"
          ? "Photos and videos from this profile will show up here."
          : "There is nothing to show here yet."}
      </Text>
    </View>
  );
}

// Web's profile Gusts tab is a 9:16 poster grid (two columns, three from the
// sm breakpoint) rather than a feed of post cards: each tile carries the Gust
// chip, a two-line content clamp over a bottom scrim, and the view and aura
// counts. Tapping opens the reel at that gust rather than the post page, the
// same target the media tab uses, so a tap never dead-ends on a still image.
function GustGridTile({
  onOpen,
  post,
}: {
  onOpen: (post: FeedPost) => void;
  post: FeedPost;
}) {
  const apiBase = getApiBaseUrl();
  const video = post.attachments?.find(
    (attachment) => attachment.type === "VIDEO"
  );
  const image = post.attachments?.find(
    (attachment) => attachment.type !== "VIDEO"
  );
  const flame = getAuraFlameStyle(post.aura ?? 0);
  const author = post.user?.displayName || post.user?.username || "this Gust";
  let source: { uri: string } | null = null;
  if (video) {
    source = { uri: mediaPosterUrl(apiBase, video.id) };
  } else if (image) {
    source = { uri: mediaImageUrl(apiBase, image) };
  }
  return (
    <Pressable
      accessibilityLabel={`Open Gust by ${author}`}
      accessibilityRole="button"
      onPress={() => onOpen(post)}
      style={styles.gustGridTile}
    >
      {source ? (
        <Image
          contentFit="cover"
          source={source}
          style={styles.gustGridImage}
        />
      ) : (
        <View style={[styles.gustGridImage, styles.gustGridFallback]} />
      )}
      <View style={styles.gustGridChip}>
        <Clapperboard color="#f97316" size={11} />
        <Text style={styles.gustGridChipText}>Gust</Text>
      </View>
      <View pointerEvents="none" style={styles.gustGridScrim}>
        {post.content ? (
          <Text numberOfLines={2} style={styles.gustGridContent}>
            {post.content}
          </Text>
        ) : null}
        <View style={styles.gustGridMetrics}>
          <View style={styles.gustGridMetric}>
            <Eye color="rgba(255,255,255,0.85)" size={11} />
            <Text style={styles.gustGridMetricText}>
              {formatNumber(post.viewCount ?? 0)}
            </Text>
          </View>
          <View style={styles.gustGridMetric}>
            <Flame
              color={flame.color}
              fill={flame.filled ? flame.color : "none"}
              size={11}
            />
            <Text style={styles.gustGridMetricText}>
              {formatNumber(post.aura ?? 0)}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// Web sizes each tile by the item's real dimensions so the tab reads as a
// masonry wall rather than a uniform checkerboard, falling back to square when
// an upload never recorded them.
// Web picks a tile per kind: video gets a poster and a play badge, audio gets
// the waveform and opens the parent post instead of the viewer, a moderated
// post shows a notice rather than its media, and anything that is not an image
// falls back to a generic file card. The port keeps that split.
function MediaTile({
  item,
  onOpen,
}: {
  item: ProfileMedia;
  onOpen: (item: ProfileMedia) => void;
}) {
  const apiBase = getApiBaseUrl();
  const aspectRatio = mediaTileAspect(item);
  const isImage = item.type === "IMAGE";
  const isGenericFile = !isImage && !isVideoMedia(item) && !isAudioMedia(item);
  let source: { uri: string } | null = null;
  if (isVideoMedia(item)) {
    source = { uri: mediaPosterUrl(apiBase, item.id) };
  } else if (isAudioMedia(item) || isImage) {
    source = { uri: mediaImageUrl(apiBase, item) };
  }
  const moderated = item.post?.moderated === true;
  const showFallback = moderated || isGenericFile || !source;
  const kind = item.post?.isGust ? "gust" : "post";
  const label = moderated
    ? `Open moderated ${kind}`
    : (item.altText ??
      `Open ${isAudioMedia(item) ? "post for audio" : "profile media"}`);
  let fallbackText = item.mimeType ?? "File";
  if (moderated) {
    fallbackText = item.post?.isGust ? "Moderated gust" : "Moderated post";
  }
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="link"
      onPress={() => onOpen(item)}
      style={[styles.mediaTile, { aspectRatio }]}
    >
      {showFallback || !source ? (
        <View style={[styles.mediaImage, styles.mediaFallback]}>
          <Text style={styles.mediaFallbackText}>{fallbackText}</Text>
        </View>
      ) : (
        <Image contentFit="cover" source={source} style={styles.mediaImage} />
      )}
      {isVideoMedia(item) && !moderated ? (
        <View style={styles.mediaPlay}>
          <Text style={styles.mediaPlayText}>▶</Text>
        </View>
      ) : null}
      {isAudioMedia(item) && !moderated ? (
        <View style={styles.mediaPlay}>
          <Text style={styles.mediaPlayText}>♪</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ReplyRow({
  item,
  onOpenPost,
}: {
  item: ProfileReply;
  onOpenPost: (post: FeedPost) => void;
}) {
  const { theme } = useAppTheme();
  const author = item.user;
  const displayName = author?.displayName || author?.username || "Unknown";
  return (
    <Pressable
      accessibilityLabel={`Open parent post for eddie by ${displayName}`}
      accessibilityRole="link"
      onPress={() => onOpenPost(item.post)}
      style={styles.replyRow}
    >
      <View style={styles.replyHeader}>
        <UserAvatar size={38} url={author?.avatarUrl ?? null} />
        <View style={styles.replyIdentity}>
          <View style={styles.replyNameRow}>
            <Text style={[styles.replyName, { color: theme.inputText }]}>
              {displayName}
            </Text>
            {author ? (
              <UserBadge badge={author.badge} badges={author.badges} />
            ) : null}
          </View>
          {author?.username ? (
            <Text style={[styles.replyHandle, { color: theme.dividerText }]}>
              @{author.username}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.replyDate, { color: theme.dividerText }]}>
          {new Date(item.createdAt).toLocaleDateString()}
        </Text>
      </View>
      {item.parent?.user?.username ? (
        <Text style={[styles.replyContext, { color: theme.dividerText }]}>
          Replying to @{item.parent.user.username}
        </Text>
      ) : null}
      {item.content ? (
        <BioContent
          apiBase={getApiBaseUrl()}
          bio={item.content}
          textSize={{ fontSize: 15, lineHeight: 22 }}
        />
      ) : null}
      {item.attachments.length > 0 ? (
        <View style={styles.replyAttachments}>
          {item.attachments.map((attachment) => (
            <Image
              contentFit="cover"
              key={attachment.id}
              source={{ uri: mediaImageUrl(getApiBaseUrl(), attachment) }}
              style={styles.replyAttachment}
            />
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

export function ProfileFeed({
  feed,
  header,
  locked = false,
  tab,
  viewerId,
}: {
  feed: ProfileFeedView;
  header: React.ReactElement;
  locked?: boolean;
  tab: ProfileViewTab;
  viewerId: string | null;
}) {
  const router = useRouter();
  const { theme } = useAppTheme();
  // The gusts tab is a two-column poster grid; every other tab is one column.
  const gustsGrid = tab === "gusts";
  const [sharePost, setSharePost] = useState<FeedPost | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [menuPost, setMenuPost] = useState<FeedPost | null>(null);
  const openPost = useCallback(
    (post: FeedPost) => openPostRoute(router, post.id),
    [router]
  );
  const openMedia = useCallback(
    (item: ProfileMedia) => {
      if (!item.post) {
        toast({
          description: "This media is no longer attached to a post.",
          title: "Media unavailable",
        });
        return;
      }
      if (item.post.isGust) {
        router.push({ params: { id: item.post.id }, pathname: "/gusts" });
        return;
      }
      // Audio has nothing to show in the viewer, so it goes to the post the way
      // web's audio tile does rather than opening an empty modal.
      if (isAudioMedia(item)) {
        router.push({
          params: {
            postId:
              item.post.id.length > 8 ? item.post.id.slice(0, 8) : item.post.id,
          },
          pathname: "/posts/[postId]",
        });
        return;
      }
      router.push({
        params: {
          index: "0",
          postId:
            item.post.id.length > 8 ? item.post.id.slice(0, 8) : item.post.id,
        },
        pathname: "/posts/[postId]/media/[index]",
      });
    },
    [router]
  );
  const onMore = useCallback((post: FeedPost, anchor: MenuAnchor) => {
    setMenuPost(post);
    setMenuAnchor(anchor);
  }, []);
  const onShare = useCallback((post: FeedPost) => setSharePost(post), []);
  const entries: MoreMenuEntry[] = menuPost
    ? buildMoreEntries({
        post: menuPost,
        showCaptions: false,
        showingAlt: false,
        viewerId,
      })
    : [];
  const onAction = useCallback((action: MoreAction) => {
    setMenuAnchor(null);
    setMenuPost(null);
    if (action.type === "hide") {
      toast({
        description: "This post won't appear in your feed.",
        title: "Post hidden",
      });
    } else {
      toast({
        description: "That option is not available for this post yet.",
        title: "Post options",
      });
    }
  }, []);
  // A gust tile holds a still frame, so it opens the reel at that gust rather
  // than the post page, matching the media tab and the Explore gust tiles.
  const openGust = useCallback(
    (post: FeedPost) => {
      router.push({ params: { id: post.id }, pathname: "/gusts" });
    },
    [router]
  );
  // Both grid tabs are two columns; only the column spacing differs.
  let columnStyle: ViewStyle | undefined;
  if (gustsGrid) {
    columnStyle = styles.gustRow;
  } else if (isMediaFeed(feed)) {
    columnStyle = styles.mediaRow;
  }
  const renderItem = useCallback(
    ({ item }: { item: ProfileFeedItem }) => {
      if (item.kind === "media") {
        return <MediaTile item={item.value} onOpen={openMedia} />;
      }
      if (item.kind === "reply") {
        return <ReplyRow item={item.value} onOpenPost={openPost} />;
      }
      if (gustsGrid && item.value.isGust) {
        return <GustGridTile onOpen={openGust} post={item.value} />;
      }
      return (
        <PostCard
          hasThreadChild={false}
          hasThreadParent={false}
          onMore={onMore}
          onOpenDetail={openPost}
          onShare={onShare}
          post={item.value}
          viewerId={viewerId ?? undefined}
        />
      );
    },
    [gustsGrid, onMore, onShare, openGust, openMedia, openPost, viewerId]
  );
  const keyExtractor = useCallback(
    (item: ProfileFeedItem) => `${item.kind}:${item.value.id}`,
    []
  );
  const items = feedItems(feed);
  const handleRetry = useCallback(() => feed.fetchNext(), [feed]);
  const renderFooter = () => {
    if (feed.status === "loading-more") {
      return (
        <View style={styles.footer}>
          <Spinner3D size={32} />
        </View>
      );
    }
    if (feed.hasMore || items.length === 0) {
      return null;
    }
    return (
      <Text style={[styles.caughtUp, { color: theme.dividerText }]}>
        You're all caught up.
      </Text>
    );
  };
  return (
    <>
      <FlatList
        data={items}
        key={isMediaFeed(feed) ? "profile-media" : "profile-list"}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onEndReached={feed.hasMore ? feed.fetchNext : undefined}
        onEndReachedThreshold={0.6}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            {header}
            {locked ? null : (
              <ProfileTabState feed={feed} onRetry={handleRetry} />
            )}
          </>
        }
        ListEmptyComponent={
          feed.status === "success" ? <EmptyProfileTab tab={tab} /> : null
        }
        ListFooterComponent={renderFooter}
        numColumns={gustsGrid || isMediaFeed(feed) ? 2 : 1}
        columnWrapperStyle={columnStyle}
      />
      <ShareSheet
        description="Share this post with your network"
        onClose={() => setSharePost(null)}
        post={sharePost}
        shareUrl={getSharePostUrl}
        title="Share post"
      />
      <MoreMenu
        anchor={menuAnchor}
        entries={entries}
        onAction={onAction}
        onClose={() => {
          setMenuAnchor(null);
          setMenuPost(null);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  caughtUp: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    paddingVertical: 18,
    textAlign: "center",
  },
  empty: {
    alignItems: "center",
    gap: 10,
    justifyContent: "center",
    minHeight: 260,
    paddingHorizontal: 32,
  },
  emptyCopy: { fontFamily: "SofiaProReg", fontSize: 14, textAlign: "center" },
  emptyImage: { height: 92, width: 92 },
  emptyTitle: { fontFamily: "SofiaProBold", fontSize: 18 },
  footer: { alignItems: "center", paddingVertical: 18 },
  // Web: grid-cols-2 gap-3 p-4, tiles aspect-[9/16] rounded-2xl. The chip and
  // the scrim sit inside the rounded shape, so neither can square off a corner.
  gustGridChip: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    position: "absolute",
    top: 10,
  },
  gustGridChipText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 11,
  },
  gustGridContent: {
    color: "rgba(255,255,255,0.9)",
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  gustGridFallback: { backgroundColor: "rgba(128,128,128,0.2)" },
  gustGridImage: { height: "100%", width: "100%" },
  gustGridMetric: { alignItems: "center", flexDirection: "row", gap: 4 },
  gustGridMetricText: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: "SofiaProMed",
    fontSize: 11,
  },
  gustGridMetrics: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  gustGridScrim: {
    bottom: 0,
    left: 0,
    paddingBottom: 12,
    paddingHorizontal: 12,
    paddingTop: 24,
    position: "absolute",
    right: 0,
  },
  gustGridTile: {
    aspectRatio: 9 / 16,
    borderRadius: 16,
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
  gustRow: { gap: 12, paddingHorizontal: 16, paddingTop: 16 },
  list: { paddingBottom: 28 },
  loading: {
    alignItems: "center",
    gap: 10,
    justifyContent: "center",
    minHeight: 220,
  },
  loadingText: { fontFamily: "SofiaProReg", fontSize: 14 },
  mediaFallback: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  mediaFallbackText: {
    color: "rgba(255,255,255,0.75)",
    fontFamily: "SofiaProMed",
    fontSize: 11,
    textAlign: "center",
  },
  mediaImage: { height: "100%", width: "100%" },
  mediaPlay: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
    height: 34,
    justifyContent: "center",
    left: "50%",
    marginLeft: -17,
    marginTop: -17,
    position: "absolute",
    top: "50%",
    width: 34,
  },
  mediaPlayText: { color: "#fff", fontSize: 14 },
  mediaRow: { gap: 4, paddingHorizontal: 2 },
  mediaTile: {
    backgroundColor: "rgba(128,128,128,0.2)",
    borderRadius: 10,
    flex: 1,
    overflow: "hidden",
  },
  replyAttachment: { borderRadius: 10, height: 84, width: 84 },
  replyAttachments: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
  },
  replyContext: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 10 },
  replyDate: { fontFamily: "SofiaProReg", fontSize: 11 },
  replyHandle: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 1 },
  replyHeader: { alignItems: "center", flexDirection: "row", gap: 9 },
  replyIdentity: { flex: 1 },
  replyName: { fontFamily: "SofiaProBold", fontSize: 14 },
  replyNameRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  replyRow: { gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  retry: {
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
});
