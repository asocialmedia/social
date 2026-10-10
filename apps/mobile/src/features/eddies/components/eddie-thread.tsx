// Eddie thread, port of web's comments/thread/comments.tsx + item/comment
// .tsx, in two variants:
// - "card" (feed card expansion, web FeedComments): top composer, inline
//   reply composers, a 480px clamp with a fade and the premium "Show more
//   eddies" pill that opens the post page
// - "page" (post screen): the floating bottom bar is the composer (web's
//   hasFloatingComposer), Reply targets it, "Load previous eddies" pages in
//   place, and the head refetches every 8s like web's polling
// Rows: 40px squircle avatar with the avatar ring, name + badge + @handle +
// · date, linked body, image/GIF attachment, aura vote cluster, "Reply", and
// on your own eddies the `...` menu with the red "Delete" (confirm dialog,
// then a soft delete mirrored locally). Replies indent 32px with curved rail
// connectors, up to depth 6. The flat API page is shaped into the tree
// client-side (eddie-tree.ts); new eddies from any composer merge in at once.
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { CornerDownRight } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { Path, Svg } from "react-native-svg";

import noCommentsImage from "@/assets/images/nocomments.png";
import noMediaImage from "@/assets/images/nomedia.png";
import { UserAvatar } from "@/components/avatar/user-avatar";
import { toast } from "@/components/feedback/toast";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { ORANGE_GRADIENT } from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { deleteEddie } from "@/features/composer/lib/publish-api";
import { ACTION_ICONS, MoreMenu } from "@/features/feed/components/more-menu";
import type {
  MenuAnchor,
  MoreMenuEntry,
} from "@/features/feed/components/more-menu";
import {
  MoreButton,
  VoteCluster,
} from "@/features/feed/components/post-actions";
import type { FeedComment } from "@/features/feed/lib/feed-api";
import { fetchCommentsPage } from "@/features/feed/lib/feed-api";
import { formatRelativeDate } from "@/features/feed/lib/feed-types";
import { BioContent } from "@/features/home/components/bio-content";
import { UserBadge } from "@/features/home/components/user-badge";
import { applyCountDelta } from "@/features/post/lib/comment-count-deltas";
import { usePostStream } from "@/features/post/lib/use-post-stream";
import { getApiBaseUrl } from "@/lib/api-env";
import { createExpoPoller } from "@/lib/expo-poller";
import { imageCachePolicy } from "@/lib/image-cache";
import { logError, logWarn } from "@/lib/telemetry";
import { LOGIN_BUTTON_SHADOWS, useAppTheme } from "@/theme";

import { subscribeEddieCreated } from "../lib/eddie-events";
import {
  AVATAR_CENTER,
  computeEddieRailGeometry,
  RAIL_LEFT,
  RAIL_STROKE,
  REPLY_INDENT,
} from "../lib/eddie-rail";
import {
  buildEddieTree,
  MAX_EDDIE_DEPTH,
  mergeEddies,
  withCreatedEddie,
  withDeletedEddie,
} from "../lib/eddie-tree";
import type { EddieNode } from "../lib/eddie-tree";
import { useEddieComposerStore } from "../state/eddie-composer-store";
import { DeleteEddieDialog } from "./delete-eddie-dialog";
import { EddieComposer } from "./eddie-composer";

const POLL_MS = 8000;

// First-paint guess for the avatar's centre, refined by onLayout. Keeping the
// constant here documents the expected geometry without the rail depending on it.
const RAIL_GEOMETRY_SEED = { avatarCenter: AVATAR_CENTER, commentTop: 0 };

// The entry list is pure data so it can be unit tested, which means the glyph
// lives with the panel. This row is the one place that hand-builds a single
// entry, so it takes the glyph from the same map.
const DELETE_ENTRY: MoreMenuEntry[] = [
  {
    action: { type: "delete" },
    destructive: true,
    icon: ACTION_ICONS.delete,
    label: "Delete",
  },
];

// The reply connector: a vertical run down the parent's avatar column that
// curves right into this reply's avatar, like web's rail.
//
// Split into three parts because neither shape alone can do the job in Yoga.
// The curve is an SVG, which is the only thing here that can draw an arc. But
// the rail has to run on to the bottom of the row for a non-last sibling, and a
// percentage height does not resolve against a content-sized parent - which is
// what truncated the original SVG and left the line hanging in space. So the
// run is a View (top/bottom, always resolves) and the SVG carries ONLY the
// fixed-size turn, with no percentage dimension and no negative origin to be
// clipped at the viewport edge.
function EddieRail({
  avatarCenter,
  isLast,
}: {
  // Where the avatar's centre line actually landed, measured by the row. The
  // rail is drawn against this rather than a computed constant, so it cannot
  // drift from the avatar when padding, avatar size or nesting changes.
  avatarCenter: number;
  isLast: boolean;
}) {
  const { theme } = useAppTheme();
  const color = theme.cardBorder;
  const geometry = computeEddieRailGeometry(avatarCenter, isLast);
  return (
    <>
      {/* Vertical run into the turn. A last sibling stops at the turn; one that
          still has replies below carries on to the bottom of the row, so the
          whole thread reads as one unbroken channel. */}
      <View
        pointerEvents="none"
        style={[
          styles.railVertical,
          { backgroundColor: color },
          isLast ? { height: geometry.verticalHeight ?? 0 } : { bottom: 0 },
        ]}
      />
      {/* The turn, in a box sized to hold the arc plus half a stroke of bleed
          on every side, so the stroke is never clipped at the SVG viewport. */}
      <Svg
        height={geometry.curveBox}
        pointerEvents="none"
        style={[styles.railCurve, { top: geometry.curveTop }]}
        width={geometry.curveBox}
      >
        <Path
          d={`M ${geometry.railStroke / 2} ${geometry.railStroke / 2} A ${geometry.curveRadius} ${geometry.curveRadius} 0 0 0 ${geometry.curveBox - 1} ${geometry.curveBox - 1}`}
          fill="none"
          stroke={color}
          strokeWidth={geometry.railStroke}
        />
      </Svg>
      {/* Short run from the end of the arc into the avatar, tucked under its
          edge so no seam can open at the join. */}
      <View
        pointerEvents="none"
        style={[
          styles.railTail,
          { backgroundColor: color, top: geometry.tailTop },
        ]}
      />
    </>
  );
}

// Eddie media is images and GIFs only; GIFs stream the original so they
// keep animating, stills use the md webp rung.
function eddieImageUrl(
  apiBase: string,
  media: { id: string; mimeType?: string | null }
): string {
  const base = apiBase.replace(/\/+$/, "");
  return media.mimeType === "image/gif"
    ? `${base}/api/media/${media.id}`
    : `${base}/api/media/${media.id}/v/md-webp.webp`;
}

function EddieImage({
  apiBase,
  media,
}: {
  apiBase: string;
  media: { id: string; mimeType?: string | null };
}) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.attachment}>
      <Image
        accessibilityLabel="Eddie attachment"
        cachePolicy={imageCachePolicy(
          eddieImageUrl(apiBase, media),
          media.mimeType === "image/gif"
        )}
        contentFit="contain"
        onError={() => setFailed(true)}
        source={failed ? noMediaImage : { uri: eddieImageUrl(apiBase, media) }}
        style={styles.attachmentImage}
      />
    </View>
  );
}

interface RowHandlers {
  onDelete: (commentId: string) => void;
  onLayoutRow: (commentId: string, yWithinParent: number) => void;
  onMore: (commentId: string, anchor: MenuAnchor) => void;
  /** Opens the given author's profile, as web's linked name and avatar do. */
  onOpenAuthor: (username: string) => void;
  onReply: (node: EddieNode) => void;
  onRequireLogin: () => void;
}

/** Summed y from `node` down to `targetId`, or null when it is not below. */
function offsetWithin(
  nodes: readonly EddieNode[],
  targetId: string,
  parentY = 0
): number | null {
  for (const node of nodes) {
    const ownY = rowOffsetRegistry.get(node.comment.id);
    const absolute = parentY + (ownY ?? 0);
    if (node.comment.id === targetId) {
      return absolute;
    }
    const found = offsetWithin(node.children, targetId, absolute);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

// Rows publish their offset here as they lay out. Module scope because the
// offsets describe the tree, not any one mount, and a remount with the same
// comments should resolve to the same answer.
const rowOffsetRegistry = new Map<string, number>();

function EddieRow({
  apiBase,
  handlers,
  inlineReplyFor,
  isLast,
  node,
  onCloseInlineReply,
  postId,
  viewerId,
}: {
  apiBase: string;
  handlers: RowHandlers;
  inlineReplyFor: string | null;
  isLast: boolean;
  node: EddieNode;
  onCloseInlineReply: () => void;
  postId: string;
  viewerId: string | undefined;
}) {
  const { theme } = useAppTheme();
  const { onLayoutRow, onOpenAuthor } = handlers;
  const { comment, depth } = node;
  const commentUser = comment.user ?? null;
  const username = commentUser?.username || "unknown";
  const name = commentUser?.displayName || username;
  const isDeleted = Boolean(comment.deleted);
  const showDeletedLabel = isDeleted || !commentUser;
  const beyondCap = depth > MAX_EDDIE_DEPTH;
  const hasChildren = node.children.length > 0;
  const replying = inlineReplyFor === comment.id;
  const isOwn = Boolean(viewerId && commentUser?.id === viewerId);
  const attachments = (comment.attachments ?? []).filter(
    (media) =>
      media && (media.type === "IMAGE" || media.mimeType?.startsWith("image/"))
  );

  // The rail is drawn from the avatar's real measured centre rather than a
  // computed constant, so it cannot drift from the avatar. Measured from
  // avatarWrap with alignSelf: "flex-start", which keeps it sized to the avatar
  // instead of stretched to the row - a stretched box reports the comment's
  // full height and threw the turn far below the avatar.
  // Seeded with AVATAR_CENTER so the first paint is already close, and each
  // handler no-ops when the value has not moved, so stable layouts cost nothing.
  const [rail, setRail] = useState(RAIL_GEOMETRY_SEED);
  const handleCommentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { y } = event.nativeEvent.layout;
      setRail((current) =>
        current.commentTop === y ? current : { ...current, commentTop: y }
      );
      onLayoutRow(node.comment.id, y);
    },
    [node.comment.id, onLayoutRow]
  );
  const handleAvatarLayout = useCallback((event: LayoutChangeEvent) => {
    const { height, y } = event.nativeEvent.layout;
    setRail((current) => {
      const avatarCenter = current.commentTop + y + height / 2;
      return current.avatarCenter === avatarCenter
        ? current
        : { ...current, avatarCenter };
    });
  }, []);

  return (
    <View style={[depth > 0 && !beyondCap && styles.nested]}>
      {depth > 0 && !beyondCap ? (
        <EddieRail avatarCenter={rail.avatarCenter} isLast={isLast} />
      ) : null}
      <View onLayout={handleCommentLayout} style={styles.comment}>
        {/* Stub: hangs this comment's avatar down to where its replies begin, so
            the thread line reads as dropping off the parent. Scoped to the
            comment content block, its bottom: 0 terminates cleanly at the start
            of this comment's replies rather than trailing past the thread. */}
        {hasChildren || replying ? (
          <View
            pointerEvents="none"
            style={[styles.stub, { backgroundColor: theme.cardBorder }]}
          />
        ) : null}
        <Pressable
          accessibilityLabel={`Open ${name}'s profile`}
          accessibilityRole="link"
          disabled={!username || username === "unknown"}
          onPress={() => onOpenAuthor(username)}
          style={styles.avatarWrap}
          // The rail is drawn from this wrapper's measured box, so the layout
          // pass has to stay on the wrapper rather than moving inside it.
          onLayout={handleAvatarLayout}
        >
          <UserAvatar radius={12} size={40} url={commentUser?.avatarUrl} />
        </Pressable>
        <View style={styles.commentBody}>
          <View style={styles.commentHeadRow}>
            <View style={styles.commentHead}>
              {showDeletedLabel ? (
                <Text
                  style={[styles.deletedLabel, { color: theme.dividerText }]}
                >
                  [deleted]
                </Text>
              ) : (
                <>
                  <Text
                    numberOfLines={1}
                    onPress={() => onOpenAuthor(username)}
                    style={[styles.commentName, { color: theme.inputText }]}
                  >
                    {name}
                  </Text>
                  <UserBadge
                    badge={commentUser?.badge}
                    badges={commentUser?.badges}
                    communityRoles={commentUser?.communityMemberships}
                  />
                  <Text
                    numberOfLines={1}
                    style={[styles.commentHandle, { color: theme.dividerText }]}
                  >
                    @{username}
                  </Text>
                </>
              )}
              <Text style={[styles.commentDate, { color: theme.dividerText }]}>
                ·
              </Text>
              <Text style={[styles.commentDate, { color: theme.dividerText }]}>
                {formatRelativeDate(comment.createdAt)}
              </Text>
            </View>
            {isOwn && !isDeleted ? (
              <MoreButton
                onPress={(anchor) => handlers.onMore(comment.id, anchor)}
              />
            ) : null}
          </View>
          {isDeleted ? (
            <Text style={[styles.deletedBody, { color: theme.dividerText }]}>
              This comment has been deleted.
            </Text>
          ) : null}
          {!isDeleted && comment.content ? (
            <View style={styles.commentBio}>
              <BioContent apiBase={apiBase} bio={comment.content} />
            </View>
          ) : null}
          {isDeleted
            ? null
            : attachments.map((media) => (
                <EddieImage apiBase={apiBase} key={media.id} media={media} />
              ))}
          {isDeleted ? null : (
            <View style={styles.commentActions}>
              <VoteCluster
                aura={comment.aura ?? 0}
                authorName={name}
                commentId={comment.id}
                onRequireLogin={() => handlers.onRequireLogin()}
                postId={postId}
                userVote={comment.votes?.[0]?.value ?? 0}
                viewerId={viewerId ?? null}
              />
              <Pressable
                accessibilityLabel="Reply to eddie"
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => handlers.onReply(node)}
                style={styles.replyBtn}
              >
                <CornerDownRight color={theme.dividerText} size={14} />
                <Text style={[styles.replyText, { color: theme.dividerText }]}>
                  Reply
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      {replying && !isDeleted ? (
        <View style={styles.replyComposer}>
          <EddieRail avatarCenter={rail.avatarCenter} isLast={!hasChildren} />
          <EddieComposer
            autoFocus
            inline
            onCancel={onCloseInlineReply}
            onPosted={onCloseInlineReply}
            parentId={comment.id}
            placeholder={`Reply to @${username}...`}
            postId={postId}
            replyingTo={{ username }}
          />
        </View>
      ) : null}

      {node.children.map((child, index) => (
        <EddieRow
          apiBase={apiBase}
          handlers={handlers}
          inlineReplyFor={inlineReplyFor}
          isLast={index === node.children.length - 1}
          key={child.comment.id}
          node={child}
          onCloseInlineReply={onCloseInlineReply}
          postId={postId}
          viewerId={viewerId}
        />
      ))}
    </View>
  );
}

function EddieSkeleton() {
  const { theme } = useAppTheme();
  return (
    <View style={styles.skeletonRow}>
      <View
        style={[styles.skeletonAvatar, { backgroundColor: theme.dividerLine }]}
      />
      <View style={styles.skeletonBody}>
        <View
          style={[
            styles.skeletonBar,
            { backgroundColor: theme.dividerLine, width: 120 },
          ]}
        />
        <View
          style={[
            styles.skeletonBar,
            { backgroundColor: theme.dividerLine, width: "70%" },
          ]}
        />
      </View>
    </View>
  );
}

export interface EddieThreadProps {
  /** Fires once the deep-scroll target's offset inside this thread is known. */
  onCommentOffset?: (commentId: string, yInThread: number) => void;
  postId: string;
  // Threaded cards carry tighter card padding, so the gap above the
  // border matches web's thread rhythm (pb-2) instead of the full pb-4.
  tight?: boolean;
  // "reels" is the gust drawer: composer on top with the reels-input look,
  // the whole thread unclamped with "Load previous eddies", and web's 8s
  // refetch while the drawer is open.
  variant?: "card" | "page" | "reels";
  viewerId: string | undefined;
  /** Web's ?comment= deep scroll: the eddie to bring into view. */
  scrollToCommentId?: string | null;
}

export function EddieThread({
  onCommentOffset,
  postId,
  scrollToCommentId = null,
  tight = false,
  variant = "card",
  viewerId,
}: EddieThreadProps) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const setReplyingTo = useEddieComposerStore((state) => state.setReplyingTo);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState<"error" | "loading" | "ready">(
    "loading"
  );
  const [inlineReplyFor, setInlineReplyFor] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    anchor: MenuAnchor;
    commentId: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const apiBase = getApiBaseUrl();
  const isPage = variant === "page";
  const isReels = variant === "reels";
  // Page and reels both page backwards in place instead of linking out.
  const pagesInPlace = isPage || isReels;

  const loadHead = async (): Promise<boolean> => {
    try {
      const cookie = await authClient.getCookie();
      const page = await fetchCommentsPage(postId, null, { apiBase, cookie });
      setComments((current) => mergeEddies(current, page.comments));
      setCursor((current) => current ?? page.previousCursor);
      setHasMore((current) => current || page.previousCursor !== null);
      return true;
    } catch (error) {
      logWarn("eddies.load_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cookie = await authClient.getCookie();
        const page = await fetchCommentsPage(postId, null, { apiBase, cookie });
        if (cancelled) {
          return;
        }
        setComments(page.comments);
        setCursor(page.previousCursor);
        setHasMore(page.previousCursor !== null);
        setStatus("ready");
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          logWarn("eddies.load_failed", {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, postId]);

  // Eddies from composers outside this list (the floating bar) merge in.
  useEffect(
    () =>
      subscribeEddieCreated(postId, (created) => {
        setComments((current) => withCreatedEddie(current, created));
        setStatus("ready");
      }),
    [postId]
  );

  // Web holds an SSE connection open for the thread and applies created and
  // deleted events as they land, so an eddie posted elsewhere appears without
  // waiting for a tick. The poll below stays as the fallback: the stream and
  // the poll both re-read on reconnect, so they cannot disagree.
  usePostStream({
    enabled: pagesInPlace,
    kind: "comments",
    onCountDelta: (delta, eventPostId) => {
      applyCountDelta({ field: "comments", postId: eventPostId }, delta);
    },
    onEvent: (event) => {
      setComments((current) => {
        if (event.kind === "created") {
          return withCreatedEddie(current, event.payload as FeedComment);
        }
        return withDeletedEddie(current, (event.payload as FeedComment).id);
      });
      setStatus("ready");
    },
    postId,
  });

  // Web polls the post page's thread (and the open gust drawer) every 8s.
  useEffect(() => {
    if (!pagesInPlace) {
      return;
    }
    const poller = createExpoPoller({
      intervalMs: POLL_MS,
      onPoll: async () => {
        try {
          const cookie = await authClient.getCookie();
          const page = await fetchCommentsPage(postId, null, {
            apiBase,
            cookie,
          });
          setComments((current) => mergeEddies(current, page.comments));
        } catch {
          // Polling is best-effort; the next tick tries again.
        }
      },
    });
    poller.start();
    return () => poller.stop();
  }, [apiBase, pagesInPlace, postId]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const cookie = await authClient.getCookie();
      const page = await fetchCommentsPage(postId, cursor, { apiBase, cookie });
      setComments((current) => mergeEddies(current, page.comments));
      setCursor(page.previousCursor);
      setHasMore(page.previousCursor !== null);
    } catch (error) {
      logWarn("eddies.load_more_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    setLoadingMore(false);
  };

  const retryLoad = async () => {
    setStatus("loading");
    const ok = await loadHead();
    setStatus(ok ? "ready" : "error");
  };

  const requireLogin = () => {
    router.push("/(auth)/login");
  };

  // Rows report their offset within their own parent, and a reply's absolute
  // position is its parent's plus its own, so the deep-scroll target can be
  // turned into a scroll offset without measuring the whole tree at once.
  const rowOffsets = useRef(new Map<string, number>());
  const [rowsVersion, setRowsVersion] = useState(0);
  const reportRowOffset = useCallback((commentId: string, y: number) => {
    const current = rowOffsets.current.get(commentId);
    if (current === y) {
      return;
    }
    rowOffsets.current.set(commentId, y);
    // The tree reads offsets from the module registry, so a new offset means a
    // deep-scroll target may now resolve that it could not before.
    rowOffsetRegistry.set(commentId, y);
    setRowsVersion((value) => value + 1);
  }, []);

  // Deep scroll: rows land their offsets asynchronously, so the target is
  // resolved from an effect that re-runs as the tree grows. Resolving to null
  // tells the surface the eddie is not in this thread (paged out, or deleted),
  // which is what stops a scroll to a guessed position.
  useEffect(() => {
    if (!scrollToCommentId || status !== "ready") {
      return;
    }
    const y = offsetWithin(buildEddieTree(comments), scrollToCommentId);
    onCommentOffset?.(scrollToCommentId, y ?? 0);
    if (y === null) {
      // The comment id is unique on its own, so this diagnostic does not need
      // the post id, and leaving it out keeps the dependency list honest.
      logWarn("eddies.scroll_target_missing", {
        commentId: scrollToCommentId,
      });
    }
    // rowsVersion is the trigger and is deliberately not read in the body: it
    // ticks whenever a row lands its offset, which is exactly the moment the
    // target may start resolving. The compiler cannot infer that, so it reads
    // as an extra dependency.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [comments, onCommentOffset, rowsVersion, scrollToCommentId, status]);

  const handlers: RowHandlers = {
    onDelete: (commentId) => setDeleteTarget(commentId),
    onLayoutRow: reportRowOffset,
    onMore: (commentId, anchor) => setMenu({ anchor, commentId }),
    onOpenAuthor: (username) => {
      if (!viewerId) {
        requireLogin();
        return;
      }
      router.push(`/users/${username}` as "/");
    },
    onReply: (node) => {
      if (!viewerId) {
        requireLogin();
        return;
      }
      if (isPage) {
        setReplyingTo({
          commentId: node.comment.id,
          postId,
          preview: (node.comment.content ?? "").slice(0, 140),
          username: node.comment.user?.username ?? "unknown",
        });
        return;
      }
      setInlineReplyFor((current) =>
        current === node.comment.id ? null : node.comment.id
      );
    },
    onRequireLogin: requireLogin,
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      await deleteEddie(deleteTarget);
      setComments((current) => withDeletedEddie(current, deleteTarget));
      setDeleteTarget(null);
    } catch (error) {
      logError("eddies.delete_failed", error);
      toast({
        description: "Couldn't delete that eddie, try again?",
        title: "Delete Failed",
        variant: "destructive",
      });
    }
    setDeleting(false);
  };

  const tree = buildEddieTree(comments);
  const clamped = !pagesInPlace && hasMore && tree.length > 0;

  let moreControl: React.ReactNode = null;
  if (hasMore && status === "ready") {
    moreControl = pagesInPlace ? (
      <Pressable
        accessibilityRole="button"
        disabled={loadingMore}
        onPress={() => {
          void loadMore();
        }}
        style={styles.previousLink}
      >
        {loadingMore ? (
          <ActivityIndicator color={theme.dividerText} size={14} />
        ) : (
          <Text style={[styles.previousText, { color: theme.dividerText }]}>
            Load previous eddies
          </Text>
        )}
      </Pressable>
    ) : (
      <View style={styles.moreWrap}>
        <Pressable
          accessibilityLabel="Show more eddies"
          accessibilityRole="button"
          // Full id: truncated prefixes 404 when they match more than one post.
          onPress={() => router.push(`/posts/${postId}` as "/")}
        >
          {({ pressed }) => (
            <Gradient3D
              colors={ORANGE_GRADIENT}
              shadows={LOGIN_BUTTON_SHADOWS}
              style={[styles.morePill, pressed && styles.pressed]}
            >
              <Text style={styles.moreText}>Show more eddies</Text>
            </Gradient3D>
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.section,
        { borderTopColor: theme.cardBorder, marginTop: tight ? 8 : 16 },
        isReels && styles.sectionReels,
      ]}
    >
      {isPage ? null : <EddieComposer postId={postId} reels={isReels} />}
      {pagesInPlace ? moreControl : null}
      {status === "loading" ? (
        <View style={styles.skeletonList}>
          <EddieSkeleton />
          <EddieSkeleton />
          <EddieSkeleton />
        </View>
      ) : null}
      {status === "error" ? (
        <View style={styles.stateWrap}>
          <Image
            contentFit="contain"
            source={noMediaImage}
            style={styles.errorArt}
          />
          <Text style={[styles.stateText, { color: theme.dividerText }]}>
            Eddies hit a snag. Try reloading this post.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void retryLoad();
            }}
          >
            <Text style={[styles.retryText, { color: theme.dividerText }]}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : null}
      {status === "ready" && tree.length === 0 ? (
        <View style={styles.stateWrap}>
          <Image
            contentFit="contain"
            source={noCommentsImage}
            style={styles.emptyArt}
          />
          <Text style={[styles.stateText, { color: theme.dividerText }]}>
            No eddie yet.
          </Text>
        </View>
      ) : null}
      <View style={[styles.listWrap, clamped && styles.listClamped]}>
        {tree.map((node, index) => (
          <View
            key={node.comment.id}
            style={[
              index > 0 && styles.divider,
              index > 0 && { borderTopColor: theme.cardBorder },
            ]}
          >
            <EddieRow
              apiBase={apiBase}
              handlers={handlers}
              inlineReplyFor={inlineReplyFor}
              isLast={false}
              node={node}
              onCloseInlineReply={() => setInlineReplyFor(null)}
              postId={postId}
              viewerId={viewerId}
            />
          </View>
        ))}
        {clamped ? (
          <LinearGradient
            colors={["rgba(0, 0, 0, 0)", theme.containerBg]}
            end={{ x: 0.5, y: 1 }}
            pointerEvents="none"
            start={{ x: 0.5, y: 0 }}
            style={styles.fade}
          />
        ) : null}
      </View>
      {pagesInPlace ? null : moreControl}
      <MoreMenu
        anchor={menu?.anchor ?? null}
        entries={menu ? DELETE_ENTRY : []}
        onAction={(action) => {
          if (action.type === "delete" && menu) {
            handlers.onDelete(menu.commentId);
          }
        }}
        onClose={() => setMenu(null)}
      />
      <DeleteEddieDialog
        deleting={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          void confirmDelete();
        }}
        open={deleteTarget !== null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  attachment: {
    borderRadius: 8,
    marginTop: 8,
    maxWidth: 384,
    overflow: "hidden",
    width: "100%",
  },
  attachmentImage: {
    borderRadius: 8,
    height: 288,
    width: "100%",
  },
  // alignSelf stops the default row stretch from inflating this box to the full
  // comment height. The rail measures it to find the avatar's centre, and a
  // stretched box reports the row height, which threw the connector's turn well
  // below the avatar. Sized to its content it is exactly the avatar, so the
  // measurement is the avatar's real centre.
  avatarWrap: {
    alignSelf: "flex-start",
    position: "relative",
    zIndex: 1,
  },
  // paddingBottom is tighter than paddingTop: the actions row already carries
  // its own height, so equal padding left a visibly large gap under every
  // eddie before the next one (or the divider) began. relative anchors the
  // depth-0 stub to the content block rather than the whole thread.
  comment: {
    flexDirection: "row",
    gap: 10,
    paddingBottom: 6,
    paddingLeft: 16,
    paddingTop: 10,
    position: "relative",
  },
  commentActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  commentBio: {
    marginTop: 4,
  },
  commentBody: {
    flex: 1,
    minWidth: 0,
  },
  commentDate: {
    flexShrink: 0,
    fontFamily: "SofiaProReg",
    fontSize: 14,
  },
  commentHandle: {
    flexShrink: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    minWidth: 0,
  },
  commentHead: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 6,
    minWidth: 0,
  },
  commentHeadRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  commentName: {
    flexShrink: 1,
    fontFamily: "SofiaProBold",
    fontSize: 14,
    minWidth: 0,
  },
  deletedBody: {
    fontFamily: "SofiaProReg",
    fontSize: 15,
    fontStyle: "italic",
    marginTop: 4,
  },
  deletedLabel: {
    flexShrink: 0,
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  divider: {
    borderTopWidth: 1,
  },
  emptyArt: {
    height: 160,
    width: "100%",
  },
  errorArt: {
    height: 80,
    opacity: 0.7,
    width: 80,
  },
  fade: {
    bottom: 0,
    height: 72,
    left: 0,
    position: "absolute",
    right: 0,
  },
  listClamped: {
    maxHeight: 480,
    overflow: "hidden",
  },
  listWrap: {
    position: "relative",
  },
  morePill: {
    height: 32,
    paddingHorizontal: 16,
  },
  moreText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 12,
  },
  moreWrap: {
    alignItems: "center",
    marginTop: 10,
  },
  nested: {
    paddingLeft: REPLY_INDENT,
    position: "relative",
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
  previousLink: {
    alignItems: "center",
    paddingVertical: 10,
  },
  previousText: {
    fontFamily: "SofiaProMed",
    fontSize: 13,
    textDecorationLine: "underline",
  },
  // The turn. Positioned so the arc's start sits on the vertical run's axis and
  // its end lands on the avatar's centre line at REPLY_INDENT: the box's top is
  // one radius above AVATAR_CENTER (where the run hands off) and its left is
  // the rail's own left edge, so all three parts share one origin.
  railCurve: {
    left: RAIL_LEFT,
    position: "absolute",
  },
  // From the end of the arc into the avatar's left edge, overlapping by a
  // stroke so the join can never show a seam. The vertical position comes from
  // the measured avatar, so it is not set here.
  railTail: {
    height: RAIL_STROKE,
    left: REPLY_INDENT - RAIL_STROKE,
    position: "absolute",
    width: RAIL_STROKE * 2,
  },
  railVertical: {
    left: RAIL_LEFT,
    position: "absolute",
    top: 0,
    width: RAIL_STROKE,
  },
  replyBtn: {
    alignItems: "center",
    borderRadius: 9999,
    flexDirection: "row",
    gap: 4,
    height: 32,
    paddingHorizontal: 8,
  },
  // paddingTop matches the comment row's own, so the inline composer's 40px
  // avatar centres on AVATAR_CENTER (30px) exactly where the rail elbow lands.
  // Without it the elbow pointed above the avatar and the indent looked broken.
  replyComposer: {
    paddingBottom: 4,
    paddingLeft: REPLY_INDENT,
    paddingTop: 10,
    position: "relative",
  },
  replyText: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  retryText: {
    fontFamily: "SofiaProMed",
    fontSize: 13,
    marginTop: 8,
    textDecorationLine: "underline",
  },
  section: {
    borderTopWidth: 1,
    paddingBottom: 16,
    paddingTop: 2,
  },
  sectionReels: {
    borderTopWidth: 0,
    marginTop: 0,
    paddingTop: 0,
  },
  skeletonAvatar: {
    borderRadius: 12,
    height: 40,
    width: 40,
  },
  skeletonBar: {
    borderRadius: 4,
    height: 14,
    marginTop: 6,
  },
  skeletonBody: {
    flex: 1,
    minWidth: 0,
  },
  skeletonList: {
    gap: 4,
    marginTop: 12,
  },
  skeletonRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
  },
  stateText: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    marginTop: 12,
    textAlign: "center",
  },
  stateWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
  },
  // Web's stub is `top-6` against its own AVATAR_CENTER of 24, i.e. the line
  // drops from the centre of the avatar. Native's AVATAR_CENTER is 30, so the
  // same relationship is expressed with the constant rather than a stale 24.
  // RAIL_LEFT centers the 2px stroke on RAIL_X, matching railVertical.
  stub: {
    bottom: 0,
    left: RAIL_LEFT,
    position: "absolute",
    top: AVATAR_CENTER,
    width: RAIL_STROKE,
  },
});
