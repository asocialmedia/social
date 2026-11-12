import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScrollViewInstance, TextInputInstance } from "react-native";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { useComposerStore } from "@/features/composer/state/composer-store";
import { GuestAuthBar } from "@/features/home/components/guest-auth-bar";
import { invalidateProtocolResources } from "@/features/network/state/use-protocol-resource";
import { PostDetailHeader } from "@/features/post/components/post-detail-header";
import { PostDetailSkeleton } from "@/features/post/components/post-detail-skeleton";
import { recordExternalPostVisit } from "@/features/post/lib/post-api";
import {
  externalPostHeader,
  externalUriActor,
} from "@/features/post/lib/post-header";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import { cachedExternalPost } from "../lib/external-cache";
import { mergeExternalComments } from "../lib/external-comments";
import { readExternal } from "../lib/external-interactions";
import { externalPostView } from "../lib/external-post-view";
import type { FeedPost } from "../lib/feed-types";
import { useBlueskyProfile } from "../state/use-bluesky-profile";
import { BlueskyPostCard } from "./bluesky-post-card";
import { ExternalDiscussion } from "./external-discussion";
import { ExternalRelatedFeed } from "./external-related-feed";
import { ShareSheet } from "./share-sheet";

export function ExternalPostScreen() {
  const { uri: param } = useLocalSearchParams<{ uri: string }>();
  const uri = typeof param === "string" ? param : "";
  return <ExternalPostContent key={uri} uri={uri} />;
}

function ExternalPostContent({ uri }: { uri: string }) {
  const { user } = useSessionContext();
  const { theme } = useAppTheme();
  const composerOpen = useComposerStore((state) => state.isOpen);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const inputRef = useRef<TextInputInstance>(null);
  const loadMoreRelated = useRef<(() => void) | null>(null);
  const [showDiscussion, setShowDiscussion] = useState(true);
  const [discussionLoaded, setDiscussionLoaded] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [data, setData] = useState<Awaited<
    ReturnType<typeof readExternal>
  > | null>(() => {
    const cached = cachedExternalPost(uri, user?.id ?? "guest");
    return cached
      ? { comments: { cursor: null, items: [] }, post: cached }
      : null;
  });
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sharePost, setSharePost] = useState<FeedPost | null>(null);
  const profile = useBlueskyProfile(
    data?.post?.author.id ?? externalUriActor(uri)
  );
  const header = externalPostHeader(data?.post?.author ?? null, profile.data);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await readExternal(uri, undefined, signal);
        if (!signal?.aborted) {
          setData(next);
          setDiscussionLoaded(true);
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

  // Web client-post records one history visit per open for signed-in
  // viewers. The ref keeps refetches (composer close, session refresh) from
  // recording the same open again.
  const loadedPost = data?.post ?? null;
  const visitedUri = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.id || !loadedPost || visitedUri.current === loadedPost.id) {
      return;
    }
    visitedUri.current = loadedPost.id;
    void (async () => {
      await recordExternalPostVisit(loadedPost, {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      });
      // Web invalidates ["post-history"] so Recently viewed updates at once.
      invalidateProtocolResources("post-history:");
    })();
  }, [loadedPost, user?.id]);

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
                items: mergeExternalComments(
                  current.comments.items,
                  next.comments.items
                ),
              },
            }
          : next
      );
    } catch {
      setError(true);
    }
    setLoadingMore(false);
  };

  let discussionStatus: "ready" | "loading" | "error" = "ready";
  if (!discussionLoaded) {
    discussionStatus = error ? "error" : "loading";
  }

  const openDiscussion = () => {
    setShowDiscussion((current) => !current);
  };

  if (!data && !error) {
    return (
      <View style={{ backgroundColor: theme.containerBg, flex: 1 }}>
        <PostDetailSkeleton />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ backgroundColor: theme.containerBg, flex: 1 }}
    >
      <PostDetailHeader
        post={data?.post ? externalPostView(data.post) : null}
        bannerUrl={header.bannerUrl}
        title={header.title}
        subtitle={header.subtitle}
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace("/")
        }
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        ref={scrollRef}
        contentContainerStyle={{
          paddingBottom: insets.bottom + (user ? 24 : 180),
        }}
        onScroll={({ nativeEvent }) => {
          if (
            nativeEvent.contentOffset.y +
              nativeEvent.layoutMeasurement.height >=
            nativeEvent.contentSize.height - 1200
          ) {
            loadMoreRelated.current?.();
          }
        }}
        scrollEventThrottle={100}
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
        {data?.post ? (
          <BlueskyPostCard
            detail
            key={`${data.post.id}:${data.post.asm?.responses ?? 0}:${data.post.asm?.comments ?? 0}`}
            onDiscussion={openDiscussion}
            onShare={setSharePost}
            post={data.post}
          />
        ) : null}
        {data && !data.post ? (
          <Text className="p-4" style={{ color: theme.dividerText }}>
            Source post unavailable. asocialmedia discussion is preserved.
          </Text>
        ) : null}
        {data && showDiscussion ? (
          <View>
            <ExternalDiscussion
              asm={data.post?.asm}
              comments={data.comments.items}
              hasMore={Boolean(data.comments.cursor)}
              inputRef={inputRef}
              loadingMore={loadingMore}
              onChanged={() => load()}
              onLoadMore={() => {
                void more();
              }}
              onReply={() => inputRef.current?.focus()}
              status={discussionStatus}
              onRetry={() => {
                void load();
              }}
              uri={uri}
            />
          </View>
        ) : null}
        {data ? (
          <>
            <View className="flex-row items-center justify-between px-4 py-2">
              <Text
                className="text-sm font-semibold"
                style={{
                  color: theme.inputText,
                  fontFamily: "SofiaProBold",
                  fontSize: 14,
                  lineHeight: 20,
                }}
              >
                View more content
              </Text>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="View all posts on the global feed"
                onPress={() => router.replace("/")}
              >
                <Text
                  className="text-primary text-sm"
                  style={{ fontFamily: "SofiaProMed", lineHeight: 20 }}
                >
                  View all posts
                </Text>
              </Pressable>
            </View>
            <ExternalRelatedFeed
              excludeUri={uri}
              loadMoreRef={loadMoreRelated}
            />
          </>
        ) : null}
      </ScrollView>
      {user ? null : (
        <View className="absolute inset-x-0 bottom-0">
          <GuestAuthBar />
        </View>
      )}
      <ShareSheet onClose={() => setSharePost(null)} post={sharePost} />
    </KeyboardAvoidingView>
  );
}
