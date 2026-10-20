import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import noCommentsImage from "@/assets/images/nocomments.png";
import { StatusActionButton } from "@/components/feedback/status-action-button";
import { premiumInput, themeText } from "@/components/surface/recipes";
import { useSessionContext } from "@/features/auth/state/session";
import { useComposerStore } from "@/features/composer/state/composer-store";
import { DeleteEddieDialog } from "@/features/eddies/components/delete-eddie-dialog";
import {
  DELETE_ENTRY,
  EddieRow,
  eddieThreadStyles,
} from "@/features/eddies/components/eddie-thread";
import type { RowHandlers } from "@/features/eddies/components/eddie-thread";
import { buildEddieTree } from "@/features/eddies/lib/eddie-tree";
import type { FeedComment } from "@/features/feed/lib/feed-api";
import { PostDetailHeader } from "@/features/post/components/post-detail-header";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { readExternal } from "../lib/external-interactions";
import { useExternalInteractions } from "../state/use-external-interactions";
import { BlueskyPostCard } from "./bluesky-post-card";
import { MoreMenu } from "./more-menu";
import type { MenuAnchor } from "./more-menu";

const noop = () => {
  /* empty */
};

export function ExternalPostScreen() {
  const { uri: param } = useLocalSearchParams<{ uri: string }>();
  const uri = typeof param === "string" ? param : "";
  const { user } = useSessionContext();
  const { theme, isDark } = useAppTheme();
  const inputStyle = premiumInput(isDark, false);
  const textStyle = themeText(isDark);
  const composerOpen = useComposerStore((state) => state.isOpen);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const discussionY = useRef(0);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const apiBase = getApiBaseUrl();

  const [data, setData] = useState<Awaited<
    ReturnType<typeof readExternal>
  > | null>(null);
  const [error, setError] = useState(false);
  const [content, setContent] = useState("");
  const requestId = useRef(randomUUID());
  const interaction = useExternalInteractions({
    asm: data?.post?.asm,
    id: uri,
  });
  const [loadingMore, setLoadingMore] = useState(false);

  const [menu, setMenu] = useState<{
    anchor: MenuAnchor;
    commentId: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await readExternal(uri, undefined, signal);
        if (!signal?.aborted) {
          setData(next);
          setError(false);
        }
      } catch {
        if (!signal?.aborted) {
          setError(true);
        }
      }
    },
    [uri]
  );

  useEffect(() => {
    const controller = new AbortController();
    if (composerOpen) {
      return () => controller.abort();
    }
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void load(controller.signal);
      }
    });
    return () => controller.abort();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Session changes refresh viewer-specific engagement state.
  }, [load, composerOpen, user?.id]);

  const more = async () => {
    if (!data?.comments.cursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const next = await readExternal(uri, data.comments.cursor);
      setData((current) =>
        current
          ? {
              ...current,
              comments: {
                cursor: next.comments.cursor,
                items: [
                  ...current.comments.items,
                  ...next.comments.items,
                ].slice(-600),
              },
            }
          : next
      );
    } catch {
      setError(true);
    }
    setLoadingMore(false);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      if (
        await interaction.mutate({
          action: "delete_comment",
          commentId: deleteTarget,
          uri,
        })
      ) {
        setDeleteTarget(null);
        await load();
      }
    } catch {
      // Best-effort
    }
    setDeleting(false);
  };

  const openDiscussion = () => {
    scrollRef.current?.scrollTo({ animated: true, y: discussionY.current });
    inputRef.current?.focus();
  };

  const handlers: RowHandlers = {
    onDelete: (commentId) => setDeleteTarget(commentId),
    onLayoutRow: noop,
    onMore: (commentId, anchor) => setMenu({ anchor, commentId }),
    onOpenAuthor: (username) => {
      if (username.startsWith("did:") || username.includes(".")) {
        void Linking.openURL(`https://bsky.app/profile/${username}`);
      } else {
        router.push(`/users/${username}` as "/");
      }
    },
    onReply: () => {
      openDiscussion();
    },
    onRequireLogin: () => {
      router.push("/(auth)/login");
    },
  };

  const feedComments: FeedComment[] = (data?.comments.items ?? []).map(
    (comment) => ({
      content: comment.content,
      createdAt: comment.createdAt,
      deleted: comment.deleted,
      id: comment.id,
      parentId: comment.parentId ?? null,
      source: comment.source,
      user: {
        avatarUrl: comment.user?.avatarUrl ?? null,
        displayName: comment.user.displayName,
        id: comment.user.id,
        username: comment.user.username,
      },
    })
  );
  const tree = buildEddieTree(feedComments);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ backgroundColor: theme.containerBg, flex: 1 }}
    >
      <PostDetailHeader
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/")
        }
      />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void load();
            }}
            className="p-4"
          >
            <Text style={{ color: theme.dividerText }}>
              Couldn't load discussion. Try again.
            </Text>
          </Pressable>
        ) : null}
        {!data && !error ? (
          <View className="items-center gap-3 py-12">
            <ActivityIndicator color={theme.dividerText} />
            <Text style={{ color: theme.dividerText }}>Loading post…</Text>
          </View>
        ) : null}
        {data?.post ? (
          <BlueskyPostCard
            detail
            key={`${data.post.id}:${data.post.asm?.responses ?? 0}:${data.post.asm?.comments ?? 0}`}
            onDiscussion={openDiscussion}
            post={data.post}
          />
        ) : null}
        {data && !data.post ? (
          <Text className="p-4" style={{ color: theme.dividerText }}>
            Source post unavailable. asocialmedia discussion is preserved.
          </Text>
        ) : null}
        {data ? (
          <View
            onLayout={(event) => {
              discussionY.current = event.nativeEvent.layout.y;
            }}
            style={[
              eddieThreadStyles.section,
              { borderTopColor: theme.cardBorder, marginTop: 16 },
            ]}
          >
            {user ? (
              <View className="gap-2 px-4 py-3">
                <TextInput
                  accessibilityLabel="Write an eddy"
                  ref={inputRef}
                  className="rounded-xl p-3"
                  multiline
                  maxLength={1500}
                  value={content}
                  onChangeText={(text) => {
                    setContent(text);
                    requestId.current = randomUUID();
                  }}
                  placeholder="Write an eddy…"
                  placeholderTextColor={theme.dividerText}
                  style={{
                    backgroundColor: inputStyle.background,
                    boxShadow: inputStyle.shadows,
                    color: textStyle.foreground,
                    fontFamily: "SofiaProReg",
                    minHeight: 88,
                    textAlignVertical: "top",
                  }}
                />
                <View className="self-end">
                  <StatusActionButton
                    disabled={interaction.pending || !content.trim()}
                    label={interaction.pending ? "Posting…" : "Post eddy"}
                    onPress={() => {
                      void (async () => {
                        if (
                          await interaction.mutate({
                            action: "comment",
                            content,
                            requestId: requestId.current,
                            uri,
                          })
                        ) {
                          setContent("");
                          requestId.current = randomUUID();
                          await load();
                        }
                      })();
                    }}
                  />
                </View>
              </View>
            ) : (
              <Pressable
                className="px-4 py-3"
                onPress={() => router.push("/(auth)/login")}
              >
                <Text style={{ color: theme.inputText }}>
                  Sign in to join the discussion
                </Text>
              </Pressable>
            )}

            {tree.length === 0 ? (
              <View style={eddieThreadStyles.stateWrap}>
                <Image
                  contentFit="contain"
                  source={noCommentsImage}
                  style={eddieThreadStyles.emptyArt}
                />
                <Text
                  style={[
                    eddieThreadStyles.stateText,
                    { color: theme.dividerText },
                  ]}
                >
                  No eddie yet.
                </Text>
              </View>
            ) : null}

            <View style={eddieThreadStyles.listWrap}>
              {tree.map((node, index) => (
                <View
                  key={node.comment.id}
                  style={[
                    index > 0 && eddieThreadStyles.divider,
                    index > 0 && { borderTopColor: theme.cardBorder },
                  ]}
                >
                  <EddieRow
                    apiBase={apiBase}
                    handlers={handlers}
                    inlineReplyFor={null}
                    isLast={false}
                    node={node}
                    onCloseInlineReply={noop}
                    postId={uri}
                    viewerId={user?.id}
                  />
                </View>
              ))}
            </View>

            {data.comments.cursor ? (
              <Pressable
                accessibilityRole="button"
                disabled={loadingMore}
                onPress={() => {
                  void more();
                }}
                style={eddieThreadStyles.previousLink}
              >
                {loadingMore ? (
                  <ActivityIndicator color={theme.dividerText} size={14} />
                ) : (
                  <Text
                    style={[
                      eddieThreadStyles.previousText,
                      { color: theme.dividerText },
                    ]}
                  >
                    Load more eddies
                  </Text>
                )}
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <MoreMenu
        anchor={menu?.anchor ?? null}
        entries={menu ? DELETE_ENTRY : []}
        onAction={(action) => {
          if (action.type === "delete" && menu) {
            setDeleteTarget(menu.commentId);
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
    </KeyboardAvoidingView>
  );
}
