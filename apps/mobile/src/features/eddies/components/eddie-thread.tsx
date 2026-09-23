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
import { CornerDownRight, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Line, Path, Svg } from "react-native-svg";

import noCommentsImage from "@/assets/images/nocomments.png";
import noMediaImage from "@/assets/images/nomedia.png";
import { UserAvatar } from "@/components/avatar/user-avatar";
import { toast } from "@/components/feedback/toast";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { ORANGE_GRADIENT } from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { deleteEddie } from "@/features/composer/lib/publish-api";
import { MoreMenu } from "@/features/feed/components/more-menu";
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
import { getShortPostId } from "@/features/post/lib/post-path";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";
import { LOGIN_BUTTON_SHADOWS, useAppTheme } from "@/theme";

import { subscribeEddieCreated } from "../lib/eddie-events";
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

// Avatar geometry for the rail connectors: 40px avatar, 10px row padding,
// so the avatar center sits at 30px; the rail channel centers at 16px.
const AVATAR_CENTER = 30;
const RAIL_X = 16;
const CURVE_RADIUS = 16;
const REPLY_INDENT = 32;
const POLL_MS = 8000;

const DELETE_ENTRY: MoreMenuEntry[] = [
  {
    action: { type: "delete" },
    destructive: true,
    icon: Trash2,
    label: "Delete",
  },
];

function EddieRail({ isLast }: { isLast: boolean }) {
  const { theme } = useAppTheme();
  const color = theme.cardBorder;
  return (
    <Svg
      height={isLast ? AVATAR_CENTER + 4 : "100%"}
      pointerEvents="none"
      style={styles.railSvg}
      width={REPLY_INDENT + 4}
    >
      {isLast ? null : (
        <Line
          stroke={color}
          strokeWidth={2}
          x1={RAIL_X}
          x2={RAIL_X}
          y1={-1}
          y2="100%"
        />
      )}
      <Path
        d={
          isLast
            ? `M ${RAIL_X} -1 V ${AVATAR_CENTER - CURVE_RADIUS} A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 0 ${REPLY_INDENT} ${AVATAR_CENTER} H ${REPLY_INDENT + 2}`
            : `M ${RAIL_X} ${AVATAR_CENTER - CURVE_RADIUS} A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 0 ${REPLY_INDENT} ${AVATAR_CENTER} H ${REPLY_INDENT + 2}`
        }
        fill="none"
        stroke={color}
        strokeWidth={2}
      />
    </Svg>
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
  onMore: (commentId: string, anchor: MenuAnchor) => void;
  onReply: (node: EddieNode) => void;
  onRequireLogin: () => void;
}

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

  return (
    <View style={[depth > 0 && !beyondCap && styles.nested]}>
      {depth > 0 ? <EddieRail isLast={isLast} /> : null}
      {/* Stub hanging off a top-level avatar down to its replies. */}
      {depth === 0 && (hasChildren || replying) ? (
        <View
          pointerEvents="none"
          style={[styles.stub, { backgroundColor: theme.cardBorder }]}
        />
      ) : null}
      <View style={styles.comment}>
        <View style={styles.avatarWrap}>
          <UserAvatar radius={12} size={40} url={commentUser?.avatarUrl} />
        </View>
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
                commentId={comment.id}
                onRequireLogin={() => handlers.onRequireLogin()}
                postId={postId}
                userVote={comment.votes?.[0]?.value ?? 0}
                viewerLoggedIn={Boolean(viewerId)}
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
          <EddieRail isLast={!hasChildren} />
          <EddieComposer
            autoFocus
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
  postId: string;
  // Threaded cards carry tighter card padding, so the gap above the
  // border matches web's thread rhythm (pb-2) instead of the full pb-4.
  tight?: boolean;
  variant?: "card" | "page";
  viewerId: string | undefined;
}

export function EddieThread({
  postId,
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

  // Web polls the post page's thread every 8s.
  useEffect(() => {
    if (!isPage) {
      return;
    }
    const timer = setInterval(() => {
      void (async () => {
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
      })();
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [apiBase, isPage, postId]);

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

  const handlers: RowHandlers = {
    onDelete: (commentId) => setDeleteTarget(commentId),
    onMore: (commentId, anchor) => setMenu({ anchor, commentId }),
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
    } catch {
      toast({
        description: "Couldn't delete that eddie, try again?",
        title: "Delete Failed",
        variant: "destructive",
      });
    }
    setDeleting(false);
  };

  const tree = buildEddieTree(comments);
  const clamped = !isPage && hasMore && tree.length > 0;

  let moreControl: React.ReactNode = null;
  if (hasMore && status === "ready") {
    moreControl = isPage ? (
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
          onPress={() => router.push(`/posts/${getShortPostId(postId)}` as "/")}
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
      ]}
    >
      {isPage ? null : <EddieComposer postId={postId} />}
      {isPage ? moreControl : null}
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
      {isPage ? null : moreControl}
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
  avatarWrap: {
    position: "relative",
    zIndex: 1,
  },
  comment: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
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
  railSvg: {
    left: 0,
    position: "absolute",
    top: 0,
  },
  replyBtn: {
    alignItems: "center",
    borderRadius: 9999,
    flexDirection: "row",
    gap: 4,
    height: 32,
    paddingHorizontal: 8,
  },
  replyComposer: {
    paddingBottom: 4,
    paddingLeft: REPLY_INDENT,
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
  stub: {
    bottom: 0,
    left: RAIL_X,
    position: "absolute",
    top: 24,
    width: 2,
  },
});
