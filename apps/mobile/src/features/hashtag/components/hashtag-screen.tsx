// The hashtag screen, a port of web's `app/(main)/hashtag/[tag]/page.tsx`.
//
// Web server-renders a header card and a JSON-LD ItemList, and permanently
// redirects a non-canonical tag casing to the stored one. Neither the structured
// data nor the redirect has meaning in a native client, so what is ported is the
// part a person sees: the tag, its post count, and the feed.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { ExplorePostCard } from "@/features/explore/components/explore-post-card";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { getApiBaseUrl } from "@/lib/api-env";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/list-virtualization";
import { useAppTheme } from "@/theme";

import { MobileHeader } from "../../home/components/mobile-header";
import {
  canonicalTag,
  fetchHashtagPage,
  HashtagApiError,
} from "../lib/hashtag-api";

export function HashtagScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const { user } = useSessionContext();
  const params = useLocalSearchParams<{ tag?: string | string[] }>();
  const raw = Array.isArray(params.tag) ? params.tag[0] : params.tag;
  const tag = canonicalTag(raw ?? "");

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"error" | "loading" | "success">(
    "loading"
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      const options = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      if (cursor === null) {
        const page = await fetchHashtagPage(tag, null, options);
        setPosts(page.posts);
        setNextCursor(page.nextCursor);
        setStatus("success");
        setLoadError(null);
        return;
      }
      const page = await fetchHashtagPage(tag, cursor, options);
      setPosts((current) => [
        ...current,
        ...page.posts.filter(
          (post) => !current.some((row) => row.id === post.id)
        ),
      ]);
      setNextCursor(page.nextCursor);
    },
    [tag]
  );

  useEffect(() => {
    if (!tag) {
      // An incomplete hashtag is a broken deep link, not a load failure, so it
      // is derived below rather than pushed through state.
      return;
    }
    let active = true;
    void (async () => {
      try {
        await load(null);
      } catch (error) {
        if (!active) {
          return;
        }
        // oxlint-disable-next-line unicorn/catch-error-name -- `error` is the required name; it is destructured into the message below rather than shadowing a screen-level value
        setLoadError(
          error instanceof HashtagApiError
            ? error.message
            : "An error occurred while loading posts for this tag."
        );
        setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [load, tag]);

  const requireLogin = useCallback(() => {
    router.push("/(auth)/login");
  }, [router]);

  const requireLoginBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  }, [router]);

  // A tag that does not survive canonicalisation cannot be searched for.
  if (!tag) {
    return (
      <View style={[styles.center, { backgroundColor: theme.containerBg }]}>
        <Text style={[styles.body, { color: theme.dividerText }]}>
          That hashtag looks incomplete
        </Text>
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={requireLoginBack}
          style={styles.retry}
        >
          <Text style={styles.retryText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (status === "error") {
    return (
      <View style={[styles.center, { backgroundColor: theme.containerBg }]}>
        <Text style={[styles.body, { color: theme.dividerText }]}>
          {loadError}
        </Text>
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={requireLoginBack}
          style={styles.retry}
        >
          <Text style={styles.retryText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <FlatList
        {...LIST_VIRTUALIZATION_PROPS}
        contentContainerStyle={styles.content}
        data={posts}
        keyExtractor={(post) => post.id}
        ListEmptyComponent={
          status === "loading" ? (
            <ActivityIndicator color="#ff9500" style={styles.loader} />
          ) : (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
                No posts found for #{tag}
              </Text>
              <Text style={[styles.body, { color: theme.dividerText }]}>
                Be the first to rustle something about this topic.
              </Text>
            </View>
          )
        }
        ListHeaderComponent={
          <View
            style={[
              styles.header,
              { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
            ]}
          >
            <Text style={[styles.tag, { color: theme.inputText }]}>#{tag}</Text>
            <Text style={[styles.body, { color: theme.dividerText }]}>
              {posts.length > 0
                ? `${posts.length}${nextCursor ? "+" : ""} posts about this topic`
                : "Posts about this topic"}
            </Text>
          </View>
        }
        onEndReached={() => {
          if (nextCursor && status === "success") {
            void load(nextCursor);
          }
        }}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => (
          <ExplorePostCard
            onPress={() => {
              router.push({
                params: { postId: item.id },
                pathname: "/posts/[postId]",
              });
            }}
            onRequireLogin={requireLogin}
            post={item}
            viewerId={user?.id ?? null}
          />
        )}
        showsVerticalScrollIndicator={false}
      />
      <MobileHeader
        user={
          user
            ? {
                id: user.id,
                image: user.image,
                username: user.username ?? user.name,
              }
            : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: "SofiaProReg", fontSize: 13, lineHeight: 18 },
  center: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center",
    padding: 24,
  },
  content: { gap: 8, paddingBottom: 40, paddingTop: 60 },
  empty: { alignItems: "center", gap: 6, padding: 32 },
  emptyTitle: { fontFamily: "SofiaProBold", fontSize: 16 },
  header: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
    marginBottom: 4,
    marginHorizontal: 12,
    padding: 16,
  },
  loader: { marginTop: 32 },
  retry: {
    backgroundColor: "#f97316",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  retryText: { color: "#ffffff", fontFamily: "SofiaProMed", fontSize: 13 },
  root: { flex: 1 },
  tag: { fontFamily: "SofiaProBold", fontSize: 22 },
});
