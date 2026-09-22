// Inline comment section for post cards, mirroring web FeedComments:
// newest-first pages with a Show more control, nested replies, and a
// composer for signed-in viewers. Pagination follows previousCursor.
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

import { BioContent } from "../../home/components/bio-content";
import { resolveProfileImageUrl } from "../../home/components/profile-utils";
import type { FeedComment } from "../lib/feed-api";
import { createComment, fetchCommentsPage } from "../lib/feed-api";
import { formatRelativeDate } from "../lib/feed-types";

function CommentRow({
  apiBase,
  comment,
  depth,
}: {
  apiBase: string;
  comment: FeedComment;
  depth: number;
}) {
  const { theme } = useAppTheme();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const avatarUri = comment.user?.avatarUrl
    ? resolveProfileImageUrl(comment.user.avatarUrl, apiBase)
    : null;
  const name = comment.user?.displayName || comment.user?.username || "unknown";
  return (
    <View style={[styles.comment, depth > 0 && styles.nested]}>
      <Image
        contentFit="cover"
        onError={() => setAvatarFailed(true)}
        source={
          avatarUri && !avatarFailed ? { uri: avatarUri } : avatarPlaceholder
        }
        style={styles.commentAvatar}
      />
      <View style={styles.commentBody}>
        <View style={styles.commentHead}>
          <Text
            numberOfLines={1}
            style={[styles.commentName, { color: theme.inputText }]}
          >
            {name}
          </Text>
          <Text style={[styles.commentDate, { color: theme.dividerText }]}>
            {formatRelativeDate(comment.createdAt)}
          </Text>
        </View>
        {comment.content ? (
          <View style={styles.commentBio}>
            <BioContent apiBase={apiBase} bio={comment.content} />
          </View>
        ) : null}
        {(comment.replies ?? []).map((reply) => (
          <CommentRow
            apiBase={apiBase}
            comment={reply}
            depth={Math.min(depth + 1, 3)}
            key={reply.id}
          />
        ))}
      </View>
    </View>
  );
}

function Composer({
  onPosted,
  postId,
}: {
  onPosted: () => void;
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
        await createComment(postId, content, { apiBase, cookie });
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
        accessibilityLabel="Write an eddy"
        editable={!sending}
        multiline
        onChangeText={setDraft}
        placeholder="Write an eddy..."
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
      <View style={styles.composerRow}>
        <Pressable
          accessibilityLabel="Post eddy"
          accessibilityRole="button"
          disabled={draft.trim().length === 0 || sending}
          onPress={send}
          style={[
            styles.postBtn,
            draft.trim().length === 0 && styles.postBtnDisabled,
          ]}
        >
          {sending ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.postBtnText}>Post</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

interface PostCommentsProps {
  postId: string;
  viewerId: string | undefined;
}

export function PostComments({ postId, viewerId }: PostCommentsProps) {
  const { theme } = useAppTheme();
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState<"error" | "loading" | "ready">(
    "loading"
  );

  const apiBase = getApiBaseUrl();

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

  return (
    <View style={[styles.section, { borderTopColor: theme.cardBorder }]}>
      {viewerId ? (
        <Composer onPosted={refreshHead} postId={postId} />
      ) : (
        <Text style={[styles.guestNote, { color: theme.dividerText }]}>
          Log in to join the discussion.
        </Text>
      )}
      {status === "loading" ? (
        <ActivityIndicator
          color={theme.dividerText}
          size="small"
          style={styles.loader}
        />
      ) : null}
      {status === "error" ? (
        <Text style={[styles.guestNote, { color: theme.dividerText }]}>
          Couldn&apos;t load the eddies. Try again later.
        </Text>
      ) : null}
      {comments.map((comment) => (
        <CommentRow
          apiBase={apiBase}
          comment={comment}
          depth={0}
          key={comment.id}
        />
      ))}
      {hasMore && status === "ready" ? (
        <Pressable
          accessibilityLabel="Show more eddies"
          accessibilityRole="button"
          disabled={loadingMore}
          onPress={loadMore}
          style={styles.moreRow}
        >
          {loadingMore ? (
            <ActivityIndicator color={theme.dividerText} size="small" />
          ) : (
            <Text style={[styles.moreText, { color: theme.auxLink }]}>
              Show more eddies
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  comment: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  commentAvatar: {
    borderRadius: 9999,
    height: 32,
    width: 32,
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
    fontSize: 11,
    fontWeight: "normal",
  },
  commentHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  commentName: {
    flexShrink: 1,
    fontFamily: "SofiaProBold",
    fontSize: 13,
    fontWeight: "normal",
    minWidth: 0,
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
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
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
  loader: {
    marginVertical: 16,
  },
  moreRow: {
    alignItems: "center",
    paddingVertical: 12,
  },
  moreText: {
    fontFamily: "SofiaProMed",
    fontSize: 13,
    fontWeight: "normal",
  },
  nested: {
    marginLeft: 20,
  },
  postBtn: {
    alignItems: "center",
    backgroundColor: "#ff9500",
    borderRadius: 9999,
    minWidth: 72,
    paddingHorizontal: 16,
    paddingVertical: 8,
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
  section: {
    borderTopWidth: 1,
    marginTop: 12,
    paddingBottom: 4,
    paddingTop: 4,
  },
});
