import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  Clapperboard,
  CornerDownRight,
  Eye,
  FileText,
  Flame,
  Play,
  Trash2,
  Volume2,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ViewStyle } from "react-native";

import noMediaImage from "@/assets/images/nomedia.png";
import noSearchImage from "@/assets/images/nosearch.png";
import notFoundImage from "@/assets/images/notfound.png";
import { UserAvatar } from "@/components/avatar/user-avatar";
import { Spinner3D } from "@/components/feedback/spinner-3d";
import { toast } from "@/components/feedback/toast";
import { deleteEddie } from "@/features/composer/lib/publish-api";
import { DeleteEddieDialog } from "@/features/eddies/components/delete-eddie-dialog";
import {
  MoreMenu,
  buildMoreEntries,
} from "@/features/feed/components/more-menu";
import type {
  MenuAnchor,
  MoreAction,
  MoreMenuEntry,
} from "@/features/feed/components/more-menu";
import { MoreButton } from "@/features/feed/components/post-actions";
import { PostCard } from "@/features/feed/components/post-card";
import { PostLinkEmbeds } from "@/features/feed/components/post-link-embeds";
import {
  ShareSheet,
  getSharePostUrl,
} from "@/features/feed/components/share-sheet";
import { usePostOverflow } from "@/features/feed/components/use-post-overflow";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { formatRelativeDate } from "@/features/feed/lib/feed-types";
import {
  isAudioMedia,
  isVideoMedia,
  mediaImageUrl,
  mediaPosterUrl,
} from "@/features/feed/lib/media-url";
import { useLinkPreviews } from "@/features/feed/lib/use-link-previews";
import { GustRowCard } from "@/features/gusts/components/gust-row-card";
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

const EMPTY_TAB_TITLES: Record<ProfileViewTab, string> = {
  amplified: "No amplified posts yet",
  eddies: "No replies yet",
  gusts: "No Gusts yet",
  media: "No media yet",
  posts: "No posts yet",
  responses: "No responses yet",
};

const EMPTY_TAB_DESCRIPTIONS: Record<ProfileViewTab, string> = {
  amplified: "Posts this profile has amplified will show up here.",
  eddies: "When this profile replies to a post, the replies will show up here.",
  gusts: "Short-form video content from this profile will appear here.",
  media: "Media from this profile's posts will show up here",
  posts: "Share something to get the conversation started.",
  responses: "Replies from this profile will show up here.",
};

const CAUGHT_UP_NOTES: Record<ProfileViewTab, string> = {
  amplified: "You've seen every amplified post from this profile.",
  eddies: "You've seen every reply from this profile.",
  gusts: "You've seen every Gust from this profile.",
  media: "You've seen all the media from this profile.",
  posts: "You've seen every post from this profile.",
  responses: "You've seen every response from this profile.",
};

const AUDIO_WAVEFORM_BARS = [
  0.35, 0.6, 0.45, 0.85, 0.7, 1, 0.65, 0.9, 0.5, 0.75, 0.4, 0.65, 0.3, 0.55,
];

function FeedCaughtUp({ note }: { note?: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.caughtUpContainer}>
      <Image
        contentFit="contain"
        source={noSearchImage}
        style={styles.caughtUpImage}
      />
      <View style={styles.caughtUpTextWrap}>
        <Text style={[styles.caughtUpTitle, { color: theme.inputText }]}>
          You're all caught up
        </Text>
        <Text style={[styles.caughtUpNote, { color: theme.dividerText }]}>
          {note ?? "You've seen everything here."}
        </Text>
      </View>
    </View>
  );
}

function EmptyProfileTab({
  isOwnProfile,
  tab,
}: {
  isOwnProfile?: boolean;
  tab: ProfileViewTab;
}) {
  const { theme } = useAppTheme();
  const isMedia = tab === "media" || tab === "gusts";
  const image = isMedia ? noMediaImage : notFoundImage;
  const title = EMPTY_TAB_TITLES[tab] ?? "No items yet";
  let description =
    EMPTY_TAB_DESCRIPTIONS[tab] ?? "There is nothing to show here yet.";

  if (tab === "responses" && isOwnProfile) {
    description = "Replies you post to other fleets will show up here.";
  }

  return (
    <View style={styles.empty}>
      <Image contentFit="contain" source={image} style={styles.emptyImage} />
      <View style={styles.emptyTextWrap}>
        <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
          {title}
        </Text>
        <Text style={[styles.emptyCopy, { color: theme.dividerText }]}>
          {description}
        </Text>
      </View>
    </View>
  );
}

// Web's profile Gusts tab is a 9:16 poster grid (two columns): each tile
// carries the Gust chip, a two-line content clamp over a bottom scrim, and the
// view and aura counts. Tapping opens the reel viewer at that gust.
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
          style={[
            styles.gustGridImage,
            post.explicitContent ? styles.mediaBlurred : null,
          ]}
        />
      ) : (
        <View style={[styles.gustGridImage, styles.gustGridFallback]} />
      )}
      <View style={styles.gustGridChip}>
        <Clapperboard color="#f97316" size={10} />
        <Text style={styles.gustGridChipText}>Gust</Text>
      </View>
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.45)", "rgba(0,0,0,0.85)"]}
        locations={[0, 0.4, 1]}
        pointerEvents="none"
        style={styles.gustGridScrim}
      >
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
      </LinearGradient>
    </Pressable>
  );
}

function renderMediaContent({
  fallbackText,
  isAudio,
  isGenericFile,
  item,
  moderated,
  showFallback,
  source,
  theme,
}: {
  fallbackText: string;
  isAudio: boolean;
  isGenericFile: boolean;
  item: ProfileMedia;
  moderated: boolean;
  showFallback: boolean;
  source: { uri: string } | null;
  theme: { cardBg: string; dividerText: string };
}) {
  if (isAudio && !moderated) {
    return (
      <View
        style={[styles.mediaAudioContainer, { backgroundColor: theme.cardBg }]}
      >
        <View style={styles.mediaAudioBadge}>
          <LinearGradient
            colors={["#ff9500", "#e65500"]}
            end={{ x: 0.5, y: 1 }}
            start={{ x: 0.5, y: 0 }}
            style={styles.mediaBadgeGradient}
          >
            <Volume2 color="#ffffff" size={11} />
          </LinearGradient>
        </View>
        <View style={styles.waveformContainer}>
          {AUDIO_WAVEFORM_BARS.map((height, idx) => (
            <View
              key={idx}
              style={[
                styles.waveformBar,
                {
                  height: `${Math.round(height * 100)}%`,
                  opacity: 0.6 + height * 0.4,
                },
              ]}
            />
          ))}
        </View>
      </View>
    );
  }

  if (isGenericFile && !moderated) {
    return (
      <View style={styles.mediaGenericContainer}>
        <FileText color="#f97316" size={28} />
        <Text
          numberOfLines={1}
          style={[styles.mediaFallbackText, { color: theme.dividerText }]}
        >
          {fallbackText}
        </Text>
      </View>
    );
  }

  if (showFallback || !source) {
    return (
      <View style={[styles.mediaImage, styles.mediaFallback]}>
        <Text style={styles.mediaFallbackText}>{fallbackText}</Text>
      </View>
    );
  }

  return (
    <Image
      contentFit="cover"
      source={source}
      style={[
        styles.mediaImage,
        item.post?.explicitContent ? styles.mediaBlurred : null,
      ]}
    />
  );
}

// Media tile with 1:1 parity with web's media-gallery. Video items display the
// 3D orange play button badge, audio items show waveform visualizer bars, and
// the tile frame uses rounded corners matching web's responsive layout.
function MediaTile({
  item,
  onOpen,
}: {
  item: ProfileMedia;
  onOpen: (item: ProfileMedia) => void;
}) {
  const { theme } = useAppTheme();
  const apiBase = getApiBaseUrl();
  const aspectRatio = mediaTileAspect(item);
  const isImage = item.type === "IMAGE";
  const isVideo = isVideoMedia(item);
  const isAudio = isAudioMedia(item);
  const isGenericFile = !isImage && !isVideo && !isAudio;

  let source: { uri: string } | null = null;
  if (isVideo) {
    source = { uri: mediaPosterUrl(apiBase, item.id) };
  } else if (isAudio || isImage) {
    source = { uri: mediaImageUrl(apiBase, item) };
  }

  const moderated = item.post?.moderated === true;
  const showFallback = moderated || isGenericFile || !source;
  const kind = item.post?.isGust ? "gust" : "post";
  let fallbackLabel = "profile media";
  if (isAudio) {
    fallbackLabel = "post for audio";
  }
  const label = moderated
    ? `Open moderated ${kind}`
    : (item.altText ?? `Open ${fallbackLabel}`);
  let fallbackText = item.mimeType ?? "File";
  if (moderated) {
    fallbackText = item.post?.isGust ? "Moderated gust" : "Moderated post";
  }

  return (
    <View style={styles.mediaTileWrap}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="link"
        onPress={() => onOpen(item)}
        style={[
          styles.mediaTile,
          {
            aspectRatio,
            backgroundColor: theme.cardBg,
            borderColor: theme.cardBorder,
          },
        ]}
      >
        {renderMediaContent({
          fallbackText,
          isAudio,
          isGenericFile,
          item,
          moderated,
          showFallback,
          source,
          theme,
        })}

        {isVideo && !moderated ? (
          <View style={styles.mediaVideoBadge}>
            <LinearGradient
              colors={["#ff9500", "#e65500"]}
              end={{ x: 0.5, y: 1 }}
              start={{ x: 0.5, y: 0 }}
              style={styles.mediaBadgeGradient}
            >
              <Play
                color="#ffffff"
                fill="#ffffff"
                size={11}
                style={styles.playIconOffset}
              />
            </LinearGradient>
          </View>
        ) : null}
      </Pressable>

      <Text
        numberOfLines={1}
        style={[styles.mediaFooterLink, { color: theme.dividerText }]}
      >
        View {item.post?.isGust ? "gust" : "post"}
      </Text>
    </View>
  );
}

// Web's profile Eddies tab features a 2-column layout (avatar left, content right),
// relative timestamp, highlighted reply recipient, inline attachments, embeds,
// aura rating pill, and a tactile reply button.
function ReplyRow({
  item,
  onDeleted,
  onOpenPost,
  viewerId,
}: {
  item: ProfileReply;
  onDeleted: () => void;
  onOpenPost: (post: FeedPost) => void;
  viewerId: string | null;
}) {
  const { theme } = useAppTheme();
  const author = item.user;
  const displayName = author?.displayName || author?.username || "Unknown";
  const repliedToUsername =
    item.parent?.user?.username ?? item.post?.user?.username ?? "someone";
  const { embeds } = useLinkPreviews(item.content);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ownEddie = Boolean(viewerId) && author?.id === viewerId;

  const replyAura =
    item.votes?.reduce((acc, vote) => acc + (vote.value ?? 0), 0) ?? 0;
  const flame = getAuraFlameStyle(replyAura);

  const confirmDelete = async () => {
    setDeleting(true);
    const ok = await deleteEddie(item.id).then(
      () => true,
      () => false
    );
    setDeleting(false);
    if (ok) {
      setDeleteOpen(false);
      onDeleted();
      return;
    }
    toast({
      description: "We couldn't delete that. Try again in a moment.",
      title: "Delete failed",
    });
  };

  return (
    <View style={[styles.replyRow, { borderBottomColor: theme.cardBorder }]}>
      {/* Left: author avatar */}
      <Pressable
        accessibilityLabel={`View @${author?.username ?? "user"}'s profile`}
        onPress={() => onOpenPost(item.post)}
        style={styles.replyAvatarCol}
      >
        <UserAvatar
          radius={12}
          seed={author?.username ?? author?.id}
          size={38}
          url={author?.avatarUrl ?? null}
          userId={author?.id}
          username={author?.username}
        />
      </Pressable>
      {/* Right: header, context, body, embeds, and actions */}
      <View style={styles.replyMainCol}>
        <View style={styles.replyHeaderLine}>
          <Text
            numberOfLines={1}
            style={[styles.replyName, { color: theme.inputText }]}
          >
            {displayName}
          </Text>
          {author ? (
            <UserBadge badge={author.badge} badges={author.badges} />
          ) : null}
          {author?.username ? (
            <Text
              numberOfLines={1}
              style={[styles.replyHandle, { color: theme.dividerText }]}
            >
              @{author.username}
            </Text>
          ) : null}
          <Text style={[styles.replyDot, { color: theme.dividerText }]}>·</Text>
          <Text style={[styles.replyDate, { color: theme.dividerText }]}>
            {formatRelativeDate(item.createdAt)}
          </Text>
          {ownEddie ? (
            <View style={styles.replyMenuButtonWrap}>
              <MoreButton onPress={(anchor) => setMenuAnchor(anchor)} />
            </View>
          ) : null}
        </View>
        <Text style={[styles.replyContext, { color: theme.dividerText }]}>
          Replying to{" "}
          <Text style={{ color: "#f97316" }}>@{repliedToUsername}</Text>
        </Text>
        <Pressable
          accessibilityLabel={`Open post for eddie by ${displayName}`}
          onPress={() => onOpenPost(item.post)}
          style={styles.replyBodyPressable}
        >
          {item.content ? (
            <BioContent
              apiBase={getApiBaseUrl()}
              bio={item.content}
              textSize={{ fontSize: 14, lineHeight: 20 }}
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

          {embeds.length > 0 ? (
            <View style={styles.replyEmbeds}>
              <PostLinkEmbeds apiBase={getApiBaseUrl()} embeds={embeds} />
            </View>
          ) : null}
        </Pressable>
        {/* Actions: Aura indicator and Reply button */}
        <View style={styles.replyActionsRow}>
          <View style={styles.replyAuraPill}>
            <Flame
              color={flame.color}
              fill={flame.filled ? flame.color : "none"}
              size={12}
            />
            <Text style={[styles.replyAuraText, { color: theme.dividerText }]}>
              {formatNumber(replyAura)}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Reply to eddie"
            accessibilityRole="button"
            onPress={() => onOpenPost(item.post)}
            style={[
              styles.replyActionButton,
              {
                backgroundColor: theme.containerBg,
                borderColor: theme.cardBorder,
              },
            ]}
          >
            <CornerDownRight color={theme.dividerText} size={13} />
            <Text
              style={[styles.replyActionText, { color: theme.dividerText }]}
            >
              Reply
            </Text>
          </Pressable>
        </View>
      </View>
      {ownEddie ? (
        <>
          <MoreMenu
            anchor={menuAnchor}
            entries={
              menuAnchor
                ? [
                    {
                      action: { type: "delete" },
                      destructive: true,
                      icon: Trash2,
                      label: "Delete",
                    },
                  ]
                : []
            }
            onAction={(action) => {
              setMenuAnchor(null);
              if (action.type === "delete") {
                setDeleteOpen(true);
              }
            }}
            onClose={() => setMenuAnchor(null)}
          />
          <DeleteEddieDialog
            deleting={deleting}
            onCancel={() => setDeleteOpen(false)}
            onConfirm={() => {
              void confirmDelete();
            }}
            open={deleteOpen}
          />
        </>
      ) : null}
    </View>
  );
}

export function ProfileFeed({
  feed,
  header,
  isOwnProfile = false,
  locked = false,
  onSwipeNavigate,
  tab,
  viewerId,
}: {
  feed: ProfileFeedView;
  header: React.ReactElement;
  isOwnProfile?: boolean;
  locked?: boolean;
  onSwipeNavigate?: (direction: -1 | 1) => void;
  tab: ProfileViewTab;
  viewerId: string | null;
}) {
  const router = useRouter();
  const { theme } = useAppTheme();

  const gustsGrid = tab === "gusts";
  const [sharePost, setSharePost] = useState<FeedPost | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [menuPost, setMenuPost] = useState<FeedPost | null>(null);

  // Tab change smooth slide animation
  const activeTabTrackedRef = useRef(tab);
  const slideAnim = useMemo(() => new Animated.Value(0), []);
  const opacityAnim = useMemo(() => new Animated.Value(1), []);

  useEffect(() => {
    if (activeTabTrackedRef.current !== tab) {
      const tabOrder: ProfileViewTab[] = viewerId
        ? ["posts", "gusts", "responses", "eddies", "amplified", "media"]
        : ["posts", "gusts", "media"];
      const nextIndex = tabOrder.indexOf(tab);
      const prevIndex = tabOrder.indexOf(activeTabTrackedRef.current);
      const direction = nextIndex >= prevIndex ? 1 : -1;
      activeTabTrackedRef.current = tab;

      slideAnim.setValue(direction * 32);
      opacityAnim.setValue(0.7);

      Animated.parallel([
        Animated.timing(slideAnim, {
          duration: 180,
          toValue: 0,
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(opacityAnim, {
          duration: 180,
          toValue: 1,
          useNativeDriver: Platform.OS !== "web",
        }),
      ]).start();
    }
  }, [opacityAnim, slideAnim, tab, viewerId]);

  // Swipe navigation PanResponder tracking horizontal gestures
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => {
          if (gesture.numberActiveTouches !== 1) {
            return false;
          }
          const absDx = Math.abs(gesture.dx);
          const absDy = Math.abs(gesture.dy);
          return absDx > 12 && absDx > absDy * 1.35;
        },
        onPanResponderRelease: (_event, gesture) => {
          const { dx, vx } = gesture;
          if (dx <= -48 || vx <= -0.45) {
            onSwipeNavigate?.(1);
          } else if (dx >= 48 || vx >= 0.45) {
            onSwipeNavigate?.(-1);
          }
        },
      }),
    [onSwipeNavigate]
  );

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

  const overflow = usePostOverflow({
    onDeleted: () => {
      feed.reload();
    },
    onHide: () => {
      toast({
        description: "This post won't appear in your feed.",
        title: "Post hidden",
      });
    },
    onModerated: () => {
      feed.reload();
    },
    onTagsSaved: () => {
      feed.reload();
    },
    viewerId,
  });

  const onAction = useCallback(
    (action: MoreAction) => {
      const target = menuPost;
      setMenuAnchor(null);
      setMenuPost(null);
      if (target) {
        overflow.onAction(action, target);
      }
    },
    [menuPost, overflow]
  );

  const openGust = useCallback(
    (post: FeedPost) => {
      router.push({ params: { id: post.id }, pathname: "/gusts" });
    },
    [router]
  );

  const twoColumns = gustsGrid || isMediaFeed(feed);
  let columnStyle: ViewStyle | undefined;
  if (gustsGrid) {
    columnStyle = styles.gustRow;
  } else if (isMediaFeed(feed)) {
    columnStyle = styles.mediaRow;
  }

  const onReplyDeleted = useCallback(() => feed.reload(), [feed]);

  const renderItem = useCallback(
    ({ item }: { item: ProfileFeedItem }) => {
      if (item.kind === "media") {
        return <MediaTile item={item.value} onOpen={openMedia} />;
      }
      if (item.kind === "reply") {
        return (
          <ReplyRow
            item={item.value}
            onDeleted={onReplyDeleted}
            onOpenPost={openPost}
            viewerId={viewerId}
          />
        );
      }
      if (gustsGrid && item.value.isGust) {
        return <GustGridTile onOpen={openGust} post={item.value} />;
      }
      if (tab === "amplified" && item.value.isGust) {
        return <GustRowCard onOpen={openGust} post={item.value} />;
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
    [
      gustsGrid,
      onMore,
      onReplyDeleted,
      onShare,
      openGust,
      openMedia,
      openPost,
      tab,
      viewerId,
    ]
  );

  const renderSeparator = useCallback(() => {
    if (twoColumns || tab === "eddies") {
      return null;
    }
    return (
      <View
        style={[styles.itemSeparator, { backgroundColor: theme.cardBorder }]}
      />
    );
  }, [tab, theme.cardBorder, twoColumns]);

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
    const note = CAUGHT_UP_NOTES[tab] ?? "You've seen everything here.";
    return <FeedCaughtUp note={note} />;
  };

  return (
    <View style={styles.rootContainer} {...panResponder.panHandlers}>
      <Animated.View
        style={[
          styles.animatedViewport,
          {
            opacity: opacityAnim,
            transform: [{ translateX: slideAnim }],
          },
        ]}
      >
        <FlatList
          ItemSeparatorComponent={renderSeparator}
          ListEmptyComponent={
            feed.status === "success" ? (
              <EmptyProfileTab isOwnProfile={isOwnProfile} tab={tab} />
            ) : null
          }
          ListFooterComponent={renderFooter}
          ListHeaderComponent={
            <>
              {header}
              {locked ? null : (
                <ProfileTabState feed={feed} onRetry={handleRetry} />
              )}
            </>
          }
          columnWrapperStyle={columnStyle}
          contentContainerStyle={styles.list}
          data={items}
          key={twoColumns ? "grid" : "list"}
          keyExtractor={keyExtractor}
          numColumns={twoColumns ? 2 : 1}
          onEndReached={feed.hasMore ? feed.fetchNext : undefined}
          onEndReachedThreshold={0.6}
          renderItem={renderItem}
        />
      </Animated.View>

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
      {overflow.dialogs}
    </View>
  );
}

const styles = StyleSheet.create({
  animatedViewport: {
    flex: 1,
  },
  caughtUpContainer: {
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 36,
  },
  caughtUpImage: {
    height: 96,
    width: 96,
  },
  caughtUpNote: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    textAlign: "center",
  },
  caughtUpTextWrap: {
    alignItems: "center",
    gap: 6,
  },
  caughtUpTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 16,
  },
  empty: {
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
    minHeight: 260,
    paddingHorizontal: 32,
    paddingVertical: 24,
  },
  emptyCopy: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    textAlign: "center",
  },
  emptyImage: {
    height: 120,
    width: 120,
  },
  emptyTextWrap: {
    alignItems: "center",
    gap: 6,
  },
  emptyTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 16,
    textAlign: "center",
  },
  footer: { alignItems: "center", paddingVertical: 18 },
  gustGridChip: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    left: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    position: "absolute",
    top: 8,
  },
  gustGridChipText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 10,
  },
  gustGridContent: {
    color: "rgba(255,255,255,0.92)",
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
    paddingTop: 28,
    position: "absolute",
    right: 0,
  },
  gustGridTile: {
    aspectRatio: 9 / 16,
    backgroundColor: "#000000",
    borderRadius: 16,
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
  gustRow: { gap: 12, paddingHorizontal: 16, paddingTop: 14 },
  itemSeparator: {
    height: StyleSheet.hairlineWidth,
    width: "100%",
  },
  list: { paddingBottom: 28 },
  loading: {
    alignItems: "center",
    gap: 10,
    justifyContent: "center",
    minHeight: 220,
  },
  loadingText: { fontFamily: "SofiaProReg", fontSize: 14 },
  mediaAudioBadge: {
    position: "absolute",
    right: 8,
    top: 8,
    zIndex: 2,
  },
  mediaAudioContainer: {
    alignItems: "center",
    height: "100%",
    justifyContent: "center",
    padding: 12,
    position: "relative",
    width: "100%",
  },
  mediaBadgeGradient: {
    alignItems: "center",
    borderRadius: 999,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  mediaBlurred: {
    opacity: 0.5,
  },
  mediaFallback: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  mediaFallbackText: {
    fontFamily: "SofiaProMed",
    fontSize: 11,
    textAlign: "center",
  },
  mediaFooterLink: {
    fontFamily: "SofiaProMed",
    fontSize: 11,
    paddingHorizontal: 2,
    paddingTop: 4,
  },
  mediaGenericContainer: {
    alignItems: "center",
    gap: 6,
    height: "100%",
    justifyContent: "center",
    padding: 12,
    width: "100%",
  },
  mediaImage: { height: "100%", width: "100%" },
  mediaRow: { gap: 10, paddingHorizontal: 12, paddingTop: 12 },
  mediaTile: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  mediaTileWrap: {
    flex: 1,
    marginBottom: 4,
  },
  mediaVideoBadge: {
    position: "absolute",
    right: 8,
    top: 8,
    zIndex: 2,
  },
  playIconOffset: {
    marginLeft: 1,
  },
  replyActionButton: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  replyActionText: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  replyActionsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  replyAttachment: {
    borderRadius: 10,
    height: 76,
    width: 76,
  },
  replyAttachments: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  replyAuraPill: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  replyAuraText: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  replyAvatarCol: {
    paddingTop: 2,
  },
  replyBodyPressable: {
    marginTop: 4,
  },
  replyContext: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    marginTop: 2,
  },
  replyDate: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
  },
  replyDot: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  replyEmbeds: {
    marginTop: 8,
  },
  replyHandle: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
  },
  replyHeaderLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
  },
  replyMainCol: {
    flex: 1,
    minWidth: 0,
  },
  replyMenuButtonWrap: {
    marginLeft: "auto",
  },
  replyName: {
    fontFamily: "SofiaProBold",
    fontSize: 13,
  },
  replyRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  retry: {
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  rootContainer: {
    flex: 1,
  },
  waveformBar: {
    backgroundColor: "#f97316",
    borderRadius: 999,
    flex: 1,
  },
  waveformContainer: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
    height: 38,
    paddingHorizontal: 12,
    width: "100%",
  },
});
