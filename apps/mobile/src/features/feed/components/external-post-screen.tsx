// oxlint-disable react/todo -- Async mutations release request guards in finally, including failed requests.
import type { ExternalCommentPage } from "@asm/protocols/discovery";
import { randomUUID } from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { UserAvatar } from "@/components/avatar/user-avatar";
import { StatusActionButton } from "@/components/feedback/status-action-button";
import { premiumInput, themeText } from "@/components/surface/recipes";
import { useSessionContext } from "@/features/auth/state/session";
import { useComposerStore } from "@/features/composer/state/composer-store";
import { PostDetailHeader } from "@/features/post/components/post-detail-header";
import { useAppTheme } from "@/theme";

import { externalRequest, readExternal } from "../lib/external-interactions";
import { formatRelativeDate } from "../lib/feed-types";
import type { FeedPost } from "../lib/feed-types";
import { useExternalInteractions } from "../state/use-external-interactions";
import { BlueskyPostCard } from "./bluesky-post-card";
import { MoreMenu } from "./more-menu";
import type { MenuAnchor } from "./more-menu";
import { PostCard } from "./post-card";
import { ShareSheet } from "./share-sheet";
import { usePostOverflow } from "./use-post-overflow";

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
  const [responses, setResponses] = useState<{
    items: FeedPost[];
    cursor: { createdAt: string; id: string } | null;
  }>({ cursor: null, items: [] });
  const [sharePost, setSharePost] = useState<FeedPost | null>(null);
  const [menuPost, setMenuPost] = useState<FeedPost | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [altIds, setAltIds] = useState<ReadonlySet<string>>(() => new Set());
  const overflow = usePostOverflow({
    onDeleted: (id) =>
      setResponses((page) => ({
        ...page,
        items: page.items.filter((post) => post.id !== id),
      })),
    onHide: (target) =>
      setResponses((page) => ({
        ...page,
        items: page.items.filter((post) => post.id !== target.id),
      })),
    onModerated: (id, next) =>
      setResponses((page) => ({
        ...page,
        items: page.items.map((post) =>
          post.id === id ? { ...post, ...next } : post
        ),
      })),
    onTagsSaved: (id, tags) =>
      setResponses((page) => ({
        ...page,
        items: page.items.map((post) =>
          post.id === id
            ? { ...post, tags: tags.map((name) => ({ id: name, name })) }
            : post
        ),
      })),
    onToggleAlt: (post) =>
      setAltIds((current) => {
        const next = new Set(current);
        if (next.has(post.id)) {
          next.delete(post.id);
        } else {
          next.add(post.id);
        }
        return next;
      }),
    viewerId: user?.id ?? null,
  });
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
  useEffect(() => {
    const controller = new AbortController();
    if (composerOpen) {
      return () => controller.abort();
    }
    void (async () => {
      try {
        const page = await externalRequest(
          new URLSearchParams({ kind: "responses", uri }),
          { signal: controller.signal }
        );
        if (!controller.signal.aborted) {
          setResponses(page as typeof responses);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError(true);
        }
      }
    })();
    return () => controller.abort();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Response rows contain viewer-specific votes and bookmarks.
  }, [uri, composerOpen, user?.id]);
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
    } finally {
      setLoadingMore(false);
    }
  };
  const remove = async (comment: ExternalCommentPage["items"][number]) => {
    if (
      await interaction.mutate({
        action: "delete_comment",
        commentId: comment.id,
        uri,
      })
    ) {
      await load();
    }
  };
  const openDiscussion = () => {
    scrollRef.current?.scrollTo({ animated: true, y: discussionY.current });
    inputRef.current?.focus();
  };
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
            Source post unavailable. ASM discussion is preserved.
          </Text>
        ) : null}
        {data ? (
          <View
            onLayout={(event) => {
              discussionY.current = event.nativeEvent.layout.y;
            }}
            className="border-t px-4 pt-4"
            style={{ borderColor: theme.cardBorder }}
          >
            <Text
              style={{
                color: theme.inputText,
                fontFamily: "SofiaProBold",
                fontSize: 16,
              }}
            >
              Eddies
            </Text>
            <Text
              className="mt-1 mb-4 text-xs"
              style={{ color: theme.dividerText }}
            >
              Discussion on ASM · Replies stay on ASM
            </Text>
            {data.comments.items.length === 0 ? (
              <Text
                className="py-4 text-sm"
                style={{ color: theme.dividerText }}
              >
                No eddies yet. Start the conversation.
              </Text>
            ) : null}
            {data?.comments.items.map((comment) => {
              const isBluesky =
                comment.source === "bluesky" ||
                comment.id.startsWith("at://") ||
                comment.user.id.startsWith("did:");
              return (
                <View
                  key={comment.id}
                  className="flex-row gap-3 border-b py-3"
                  style={{
                    borderColor: theme.cardBorder,
                    paddingLeft: comment.parentId ? 24 : 0,
                  }}
                >
                  <UserAvatar
                    size={32}
                    url={comment.user.avatarUrl}
                    username={comment.user.username}
                  />
                  <View className="min-w-0 flex-1 gap-1">
                    <View className="flex-row items-center gap-2">
                      <Text
                        numberOfLines={1}
                        style={{
                          color: theme.inputText,
                          flexShrink: 1,
                          fontFamily: "SofiaProBold",
                        }}
                      >
                        {comment.user.displayName}
                      </Text>
                      {isBluesky ? (
                        <Text
                          style={{
                            color: "#0285FF",
                            fontFamily: "SofiaProBold",
                            fontSize: 11,
                          }}
                        >
                          Bluesky
                        </Text>
                      ) : null}
                      <Text
                        style={{
                          color: theme.dividerText,
                          fontFamily: "SofiaProReg",
                          fontSize: 12,
                        }}
                      >
                        {formatRelativeDate(comment.createdAt)}
                      </Text>
                    </View>
                    <Text selectable style={{ color: theme.inputText }}>
                      {comment.deleted ? "Comment removed" : comment.content}
                    </Text>
                    {comment.userId === user?.id && !comment.deleted ? (
                      <Pressable
                        disabled={interaction.pending}
                        onPress={() => {
                          void remove(comment);
                        }}
                      >
                        <Text
                          className="py-2"
                          style={{ color: theme.dividerText }}
                        >
                          Delete
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
            {data?.comments.cursor ? (
              <Pressable
                disabled={loadingMore}
                onPress={() => {
                  void more();
                }}
              >
                <Text className="py-3" style={{ color: theme.dividerText }}>
                  More comments
                </Text>
              </Pressable>
            ) : null}
            {user ? (
              <View className="gap-2 py-4">
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
              <Pressable onPress={() => router.push("/(auth)/login")}>
                <Text className="py-4" style={{ color: theme.inputText }}>
                  Sign in to join the discussion
                </Text>
              </Pressable>
            )}
          </View>
        ) : null}
        {data ? (
          <View
            className="border-t pt-4"
            style={{ borderColor: theme.cardBorder }}
          >
            <Text
              className="px-4 pb-3"
              style={{
                color: theme.inputText,
                fontFamily: "SofiaProBold",
                fontSize: 16,
              }}
            >
              Responses on ASM
            </Text>
            {responses.items.length === 0 ? (
              <Text
                className="px-4 pb-6 text-sm"
                style={{ color: theme.dividerText }}
              >
                No responses yet. Use Respond to post a fleet.
              </Text>
            ) : null}
            {responses.items.map((post) => (
              <PostCard
                hasThreadChild={false}
                hasThreadParent={false}
                key={post.id}
                post={post}
                viewerId={user?.id}
                showAlt={altIds.has(post.id)}
                onMore={(target, anchor) => {
                  setMenuPost(target);
                  setMenuAnchor(anchor);
                }}
                onShare={setSharePost}
              />
            ))}
            {responses.cursor ? (
              <Pressable
                disabled={loadingMore}
                onPress={() => {
                  if (!responses.cursor || loadingMore) {
                    return;
                  }
                  setLoadingMore(true);
                  void (async () => {
                    try {
                      const page = await externalRequest(
                        new URLSearchParams({
                          cursor: JSON.stringify(responses.cursor),
                          kind: "responses",
                          uri,
                        })
                      );
                      const next = page as typeof responses;
                      setResponses((current) => ({
                        cursor: next.cursor,
                        items: [...current.items, ...next.items],
                      }));
                    } catch {
                      setError(true);
                    } finally {
                      setLoadingMore(false);
                    }
                  })();
                }}
              >
                <Text className="p-4" style={{ color: theme.inputText }}>
                  More responses
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <ShareSheet onClose={() => setSharePost(null)} post={sharePost} />
      <MoreMenu
        anchor={menuAnchor}
        entries={
          menuPost
            ? overflow.entriesFor(menuPost, {
                showCaptions: false,
                showingAlt: altIds.has(menuPost.id),
              })
            : []
        }
        onAction={(action) => {
          if (menuPost) {
            overflow.onAction(action, menuPost);
          }
          setMenuAnchor(null);
        }}
        onClose={() => setMenuAnchor(null)}
      />
      {overflow.dialogs}
    </KeyboardAvoidingView>
  );
}
