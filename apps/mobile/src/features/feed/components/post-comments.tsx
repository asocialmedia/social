// Inline eddie section for post cards, mirroring web FeedComments + the
// comment thread (comments/thread/comments + item/comment): a top-level
// composer for signed-in viewers, newest-first pages with a 480px clamp,
// fade and a centered premium "Show more eddies" pill, and rows with a
// 40px squircle avatar, name + badge + handle + date header, linked body,
// aura vote cluster, reply button and an inline reply composer. Nested
// replies indent 32px with curved rail connectors that terminate on the
// last sibling, and top-level rows divide like web's divide-y list.
//
// Deliberate deltas: no owner delete entry (runs through a Next server
// action with no REST equivalent), no eddie attachments (comment media
// payloads carry no resolvable URL on mobile), and pagination loads the
// next page in place (there is no post page to link to yet).
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { CornerDownRight } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Line, Path, Svg } from "react-native-svg";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import noCommentsImage from "@/assets/images/nocomments.png";
import noMediaImage from "@/assets/images/nomedia.png";
import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";
import {
  AVATAR_RING_SHADOWS,
  AVATAR_RING_SHADOWS_DARK,
  LOGIN_BUTTON_SHADOWS,
  useAppTheme,
} from "@/theme";

import { BioContent } from "../../home/components/bio-content";
import { resolveProfileImageUrl } from "../../home/components/profile-utils";
import { UserBadge } from "../../home/components/user-badge";
import type { FeedComment } from "../lib/feed-api";
import { createComment, fetchCommentsPage } from "../lib/feed-api";
import { formatRelativeDate } from "../lib/feed-types";
import { VoteCluster } from "./post-actions";

// Replies nest at most this deep, like web's MAX_COMMENT_DEPTH; deeper
// levels render flat at the same indent.
const MAX_COMMENT_DEPTH = 6;
// Avatar geometry for the rail connectors: 40px avatar, 10px row padding,
// so the avatar center sits at 30px; the rail channel centers at 16px.
const AVATAR_CENTER = 30;
const RAIL_X = 16;
const CURVE_RADIUS = 16;
const REPLY_INDENT = 32;

function CommentRail({ isLast }: { isLast: boolean }) {
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

function CommentRow({
  apiBase,
  comment,
  depth,
  isLast,
  onReplyPosted,
  onRequireLogin,
  postId,
  viewerId,
}: {
  apiBase: string;
  comment: FeedComment;
  depth: number;
  isLast: boolean;
  onReplyPosted: () => void;
  onRequireLogin: () => void;
  postId: string;
  viewerId: string | undefined;
}) {
  const { isDark, theme } = useAppTheme();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const commentUser = comment.user ?? null;
  const avatarUri = commentUser?.avatarUrl
    ? resolveProfileImageUrl(commentUser.avatarUrl, apiBase)
    : null;
  const username = commentUser?.username || "unknown";
  const name = commentUser?.displayName || username;
  const isDeleted = Boolean(comment.deleted);
  const showDeletedLabel = isDeleted || !commentUser;
  const replies =
    depth < MAX_COMMENT_DEPTH && Array.isArray(comment.replies)
      ? comment.replies
      : [];
  const hasChildren = replies.length > 0;

  const openReply = () => {
    if (!viewerId) {
      onRequireLogin();
      return;
    }
    setShowReply((value) => !value);
  };

  return (
    <View style={[depth > 0 && styles.nested]}>
      {depth > 0 ? <CommentRail isLast={isLast} /> : null}
      {/* Stub hanging off a top-level avatar down to its replies. */}
      {depth === 0 && (hasChildren || showReply) ? (
        <View
          pointerEvents="none"
          style={[styles.stub, { backgroundColor: theme.cardBorder }]}
        />
      ) : null}
      <View style={styles.comment}>
        <View style={styles.avatarWrap}>
          <Image
            contentFit="cover"
            onError={() => setAvatarFailed(true)}
            source={
              avatarUri && !avatarFailed
                ? { uri: avatarUri }
                : avatarPlaceholder
            }
            style={styles.commentAvatar}
          />
          <View
            pointerEvents="none"
            style={[
              styles.commentRing,
              {
                boxShadow: isDark
                  ? AVATAR_RING_SHADOWS_DARK
                  : AVATAR_RING_SHADOWS,
              },
            ]}
          />
        </View>
        <View style={styles.commentBody}>
          <View style={styles.commentHead}>
            {showDeletedLabel ? (
              <Text style={[styles.deletedLabel, { color: theme.dividerText }]}>
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
          {isDeleted ? (
            <Text style={[styles.deletedBody, { color: theme.dividerText }]}>
              This comment has been deleted.
            </Text>
          ) : (
            comment.content && (
              <View style={styles.commentBio}>
                <BioContent apiBase={apiBase} bio={comment.content} />
              </View>
            )
          )}
          {isDeleted ? null : (
            <View style={styles.commentActions}>
              <VoteCluster
                aura={comment.aura ?? 0}
                commentId={comment.id}
                onRequireLogin={onRequireLogin}
                postId={postId}
                userVote={comment.votes?.[0]?.value ?? 0}
                viewerLoggedIn={Boolean(viewerId)}
              />
              <Pressable
                accessibilityLabel="Reply to eddie"
                accessibilityRole="button"
                hitSlop={6}
                onPress={openReply}
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

      {showReply && !isDeleted && viewerId ? (
        <View style={styles.replyComposer}>
          <CommentRail isLast={!hasChildren} />
          <Composer
            autoFocus
            onCancel={() => setShowReply(false)}
            onPosted={() => {
              setShowReply(false);
              onReplyPosted();
            }}
            parentId={comment.id}
            placeholder={`Reply to @${username}...`}
            postId={postId}
          />
        </View>
      ) : null}

      {hasChildren
        ? replies.map((reply, index) => (
            <CommentRow
              apiBase={apiBase}
              comment={reply}
              depth={depth + 1}
              isLast={index === replies.length - 1}
              key={reply.id}
              onReplyPosted={onReplyPosted}
              onRequireLogin={onRequireLogin}
              postId={postId}
              viewerId={viewerId}
            />
          ))
        : null}
    </View>
  );
}

function Composer({
  autoFocus,
  onCancel,
  onPosted,
  parentId,
  placeholder,
  postId,
}: {
  autoFocus?: boolean;
  onCancel?: () => void;
  onPosted: () => void;
  parentId?: string;
  placeholder?: string;
  postId: string;
}) {
  const { theme } = useAppTheme();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    const content = draft.trim();
    if (!content || sending) {
      return;
    }
    setSending(true);
    setError(null);
    void (async () => {
      try {
        const apiBase = getApiBaseUrl();
        const cookie = await authClient.getCookie();
        await createComment(postId, content, { apiBase, cookie }, parentId);
        setDraft("");
        onPosted();
        // No finally: the React Compiler rejects try/finally.
        setSending(false);
      } catch (requestError) {
        setError("Couldn't post that eddy. Try again.");
        logWarn("feed.comment_failed", {
          reason:
            requestError instanceof Error
              ? requestError.message
              : String(requestError),
        });
        setSending(false);
      }
    })();
  };

  return (
    <View style={styles.composer}>
      <TextInput
        accessibilityLabel={placeholder ?? "Write an eddy"}
        autoFocus={autoFocus}
        editable={!sending}
        multiline
        onChangeText={setDraft}
        placeholder={placeholder ?? "Write an eddy..."}
        placeholderTextColor={theme.inputPlaceholder}
        style={[
          styles.input,
          {
            backgroundColor: theme.inputBg,
            borderColor: theme.inputBorder,
            color: theme.inputText,
          },
        ]}
        value={draft}
      />
      {error ? (
        <Text style={[styles.composerError, { color: "#dc2626" }]}>
          {error}
        </Text>
      ) : null}
      <View style={[styles.composerRow, onCancel && styles.composerRowSplit]}>
        {onCancel ? (
          <Pressable
            accessibilityLabel="Cancel reply"
            accessibilityRole="button"
            hitSlop={6}
            onPress={onCancel}
          >
            <Text style={[styles.cancelText, { color: theme.dividerText }]}>
              Cancel
            </Text>
          </Pressable>
        ) : null}
        <LinearGradient
          colors={["#ff9500", "#e65500"]}
          end={{ x: 0.5, y: 1 }}
          start={{ x: 0.5, y: 0 }}
          style={[
            styles.postBtn,
            { boxShadow: LOGIN_BUTTON_SHADOWS },
            draft.trim().length === 0 && styles.postBtnDisabled,
          ]}
        >
          <Pressable
            accessibilityLabel={parentId ? "Post reply" : "Post eddy"}
            accessibilityRole="button"
            disabled={draft.trim().length === 0 || sending}
            onPress={send}
            style={styles.postPress}
          >
            {sending ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.postBtnText}>Post</Text>
            )}
          </Pressable>
        </LinearGradient>
      </View>
    </View>
  );
}

function CommentSkeleton() {
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

interface PostCommentsProps {
  postId: string;
  // Threaded cards carry tighter card padding, so the gap above the
  // border matches web's thread rhythm (pb-2) instead of the full pb-4.
  tight?: boolean;
  viewerId: string | undefined;
}

export function PostComments({
  postId,
  tight = false,
  viewerId,
}: PostCommentsProps) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState<"error" | "loading" | "ready">(
    "loading"
  );

  const apiBase = getApiBaseUrl();
  const requireLogin = () => {
    router.push("/(auth)/login");
  };

  useEffect(() => {
    let cancelled = false;
    // oxlint-disable-next-line react/set-state-in-effect -- initial page load on expand; nothing to derive during render
    setStatus("loading");
    void (async () => {
      try {
        const cookie = await authClient.getCookie();
        const page = await fetchCommentsPage(postId, null, {
          apiBase,
          cookie,
        });
        if (!cancelled) {
          // oxlint-disable-next-line react/set-state-in-effect -- settling the initial load above
          setComments(page.comments);
          // oxlint-disable-next-line react/set-state-in-effect -- settling the initial load above
          setCursor(page.previousCursor);
          // oxlint-disable-next-line react/set-state-in-effect -- settling the initial load above
          setHasMore(page.previousCursor !== null);
          // oxlint-disable-next-line react/set-state-in-effect -- settling the initial load above
          setStatus("ready");
        }
      } catch (error) {
        if (!cancelled) {
          // oxlint-disable-next-line react/set-state-in-effect -- settling the initial load above
          setStatus("error");
          logWarn("feed.comments_failed", {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, postId]);

  const loadMore = () => {
    if (loadingMore || !hasMore) {
      return;
    }
    setLoadingMore(true);
    void (async () => {
      try {
        const cookie = await authClient.getCookie();
        const page = await fetchCommentsPage(postId, cursor, {
          apiBase,
          cookie,
        });
        setComments((current) => [...current, ...page.comments]);
        setCursor(page.previousCursor);
        setHasMore(page.previousCursor !== null);
      } catch (error) {
        logWarn("feed.comments_failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      // No finally: the React Compiler rejects try/finally.
      setLoadingMore(false);
    })();
  };

  const refreshHead = () => {
    void (async () => {
      try {
        const cookie = await authClient.getCookie();
        const page = await fetchCommentsPage(postId, null, {
          apiBase,
          cookie,
        });
        setComments(page.comments);
        setCursor(page.previousCursor);
        setHasMore(page.previousCursor !== null);
      } catch (error) {
        logWarn("feed.comments_failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  };

  // Web's FeedComments caps the inline eddies at 480px behind a fade with
  // a centered "Show more eddies" pill; pagination loads the next page here
  // (there is no post page to link to on mobile yet).
  const clamped = hasMore && comments.length > 0;
  return (
    <View
      style={[
        styles.section,
        {
          borderTopColor: theme.cardBorder,
          marginTop: tight ? 8 : 16,
        },
      ]}
    >
      {viewerId ? (
        <Composer onPosted={refreshHead} postId={postId} />
      ) : (
        <Text style={[styles.guestNote, { color: theme.dividerText }]}>
          Log in to join the discussion.
        </Text>
      )}
      {status === "loading" ? (
        <View style={styles.skeletonList}>
          <CommentSkeleton />
          <CommentSkeleton />
          <CommentSkeleton />
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
        </View>
      ) : null}
      {status === "ready" && comments.length === 0 ? (
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
        {comments.map((comment, index) => (
          <View
            key={comment.id}
            style={[
              index > 0 && styles.divider,
              index > 0 && { borderTopColor: theme.cardBorder },
            ]}
          >
            <CommentRow
              apiBase={apiBase}
              comment={comment}
              depth={0}
              isLast={false}
              onReplyPosted={refreshHead}
              onRequireLogin={requireLogin}
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
      {hasMore && status === "ready" ? (
        <View style={styles.moreWrap}>
          <LinearGradient
            colors={["#ff9500", "#e65500"]}
            end={{ x: 0.5, y: 1 }}
            start={{ x: 0.5, y: 0 }}
            style={[styles.morePill, { boxShadow: LOGIN_BUTTON_SHADOWS }]}
          >
            <Pressable
              accessibilityLabel="Show more eddies"
              accessibilityRole="button"
              disabled={loadingMore}
              onPress={loadMore}
              style={styles.morePress}
            >
              {loadingMore ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.moreText}>Show more eddies</Text>
              )}
            </Pressable>
          </LinearGradient>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatarWrap: {
    position: "relative",
    zIndex: 1,
  },
  cancelText: {
    fontFamily: "SofiaProMed",
    fontSize: 13,
    fontWeight: "normal",
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
  commentAvatar: {
    borderRadius: 12,
    height: 40,
    width: 40,
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
    fontWeight: "normal",
  },
  commentHandle: {
    flexShrink: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
    minWidth: 0,
  },
  commentHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  commentName: {
    flexShrink: 1,
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
    minWidth: 0,
  },
  commentRing: {
    borderRadius: 12,
    height: 40,
    left: 0,
    position: "absolute",
    top: 0,
    width: 40,
  },
  composer: {
    marginBottom: 4,
    marginTop: 12,
  },
  composerError: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    marginTop: 6,
  },
  composerRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
  },
  composerRowSplit: {
    justifyContent: "space-between",
  },
  deletedBody: {
    fontFamily: "SofiaProReg",
    fontSize: 15,
    fontStyle: "italic",
    fontWeight: "normal",
    marginTop: 4,
  },
  deletedLabel: {
    flexShrink: 0,
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
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
  guestNote: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    fontWeight: "normal",
    marginTop: 12,
    textAlign: "center",
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  listClamped: {
    maxHeight: 480,
    overflow: "hidden",
  },
  listWrap: {
    position: "relative",
  },
  loader: {
    marginVertical: 16,
  },
  morePill: {
    borderRadius: 9999,
    height: 32,
    paddingHorizontal: 16,
  },
  morePress: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  moreText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 12,
    fontWeight: "normal",
  },
  moreWrap: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 10,
  },
  nested: {
    paddingLeft: REPLY_INDENT,
    position: "relative",
  },
  postBtn: {
    borderRadius: 9999,
    height: 32,
    minWidth: 72,
    paddingHorizontal: 16,
  },
  postBtnDisabled: {
    opacity: 0.45,
  },
  postBtnText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 13,
    fontWeight: "normal",
  },
  postPress: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
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
    paddingBottom: 10,
    paddingLeft: REPLY_INDENT,
    paddingTop: 6,
    position: "relative",
  },
  replyText: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
  },
  section: {
    borderTopWidth: 1,
    paddingBottom: 16,
    paddingTop: 14,
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
    fontWeight: "normal",
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
