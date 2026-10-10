// oxlint-disable no-nested-ternary, no-void, react/todo, react/set-state-in-effect, promise/prefer-await-to-then, unicorn/no-useless-undefined
import { useRouter } from "expo-router";
import { Bookmark, Clapperboard, Heart, Terminal } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { FeedTabs } from "@/features/feed/components/feed-tabs";
import { PostCard } from "@/features/feed/components/post-card";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { useSearchStore } from "@/features/search/state/search-store";
import { getApiBaseUrl } from "@/lib/api-env";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/list-virtualization";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { useAppTheme } from "@/theme";

import { MobileBottomNav } from "../../home/components/mobile-bottom-nav";
import { MobileHeader } from "../../home/components/mobile-header";
import {
  fetchBookmarkedHn,
  fetchBookmarkedPosts,
  fetchLikedPosts,
} from "../lib/bookmarks-api";
import type { HnStory } from "../lib/bookmarks-api";

type BookmarkTab = "posts" | "gusts" | "hackernews" | "likes";
type BookmarkData = (FeedPost | HnStory)[];

const TABS = [
  { label: "Posts", value: "posts" as const },
  { label: "Gusts", value: "gusts" as const },
  { label: "HackerNews", value: "hackernews" as const },
  { label: "Likes", value: "likes" as const },
];

function isHnStory(value: FeedPost | HnStory): value is HnStory {
  return "title" in value;
}

function HnRow({ story }: { story: HnStory }) {
  const { theme } = useAppTheme();
  return (
    <View
      style={[
        styles.hnRow,
        { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
      ]}
    >
      <Text style={[styles.hnTitle, { color: theme.inputText }]}>
        {story.title}
      </Text>
      <Text style={[styles.hnMeta, { color: theme.dividerText }]}>
        {story.score} points · {story.descendants} comments · by {story.by}
      </Text>
      {story.url ? (
        <Text
          numberOfLines={1}
          style={[styles.hnUrl, { color: theme.auxLink }]}
        >
          {story.url}
        </Text>
      ) : null}
    </View>
  );
}

export function BookmarksScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { isPending, user } = useSessionContext();
  const [tab, setTab] = useState<BookmarkTab>("posts");
  const [data, setData] = useState<BookmarkData>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const viewerId = user?.id ?? null;

  const insets = useSafeAreaInsets();
  const [dockHeight, setDockHeight] = useState(56);

  // Every request is numbered, and the view it was issued for is remembered.
  // A response may only land if it is still the newest request *and* the tab
  // and viewer it was asked for are the ones on screen: a tab switch starts
  // another request, and without this a slow earlier one would replace the
  // active tab's results - HackerNews rows rendered as posts, with a count
  // counted from the other tab's list. The sign-out case matters too, since
  // nothing starts a replacement request when the viewer goes away.
  const latestRequestRef = useRef(0);
  const currentViewRef = useRef({ tab, viewerId });
  useEffect(() => {
    currentViewRef.current = { tab, viewerId };
  }, [tab, viewerId]);

  const load = useCallback(async () => {
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    if (!user) {
      router.replace("/(auth)/login");
      return;
    }
    const requestedTab = tab;
    const requestedViewer = viewerId;
    const isCurrent = () =>
      latestRequestRef.current === requestId &&
      currentViewRef.current.tab === requestedTab &&
      currentViewRef.current.viewerId === requestedViewer;
    setLoading(true);
    setError(null);
    try {
      const cookie = await authClient.getCookie();
      const options = { apiBase: getApiBaseUrl(), cookie };
      let next: BookmarkData;
      if (requestedTab === "hackernews") {
        next = await fetchBookmarkedHn(options);
      } else if (requestedTab === "likes") {
        next = await fetchLikedPosts(options);
      } else {
        next = await fetchBookmarkedPosts(requestedTab, options);
      }
      if (!isCurrent()) {
        return;
      }
      setData(next);
    } catch {
      if (!isCurrent()) {
        return;
      }
      setError("We couldn’t load your bookmarks.");
      setLoading(false);
      return;
    }
    setLoading(false);
  }, [router, tab, user, viewerId]);

  useEffect(() => {
    if (!isPending) {
      // oxlint-disable-next-line react/set-state-in-effect -- external bookmark request starts when auth resolves
      load().catch(() => undefined);
    }
  }, [isPending, load]);

  const counts = useMemo(() => ({ current: data.length }), [data.length]);
  const header = (
    <View>
      <View style={styles.titleRow}>
        <View>
          <Text style={[styles.title, { color: theme.inputText }]}>
            Bookmarks
          </Text>
          <Text style={[styles.subtitle, { color: theme.dividerText }]}>
            Your saved posts and stories
          </Text>
        </View>
        <Bookmark color="#ff9500" fill="#ff9500" size={25} />
      </View>
      <FeedTabs active={tab} fill onChange={setTab} tabs={TABS} />
      <View style={styles.countRow}>
        <Text style={[styles.countText, { color: theme.dividerText }]}>
          {counts.current} saved
        </Text>
        <Pressable
          onPress={() => {
            load().catch(() => undefined);
          }}
        >
          <Text style={[styles.refresh, { color: theme.auxLink }]}>
            Refresh
          </Text>
        </Pressable>
      </View>
    </View>
  );

  if (isPending || (!user && !error)) {
    return (
      <View style={[styles.center, { backgroundColor: theme.containerBg }]}>
        <ActivityIndicator color="#ff9500" />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader
        onSearchPress={() => useSearchStore.getState().open()}
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
      {header}
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#ff9500" />
        </View>
      ) : null}
      {error ? (
        <View
          style={[
            styles.state,
            { paddingBottom: dockHeight + insets.bottom + 12 },
          ]}
        >
          <Text style={[styles.stateTitle, { color: theme.inputText }]}>
            {error}
          </Text>
          <Pressable
            onPress={() => {
              load().catch(() => undefined);
            }}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : !loading && data.length === 0 ? (
        <View
          style={[
            styles.state,
            { paddingBottom: dockHeight + insets.bottom + 12 },
          ]}
        >
          {tab === "gusts" ? (
            <Clapperboard color={theme.dividerText} size={34} />
          ) : tab === "hackernews" ? (
            <Terminal color={theme.dividerText} size={34} />
          ) : tab === "likes" ? (
            <Heart color={theme.dividerText} size={34} />
          ) : (
            <Bookmark color={theme.dividerText} size={34} />
          )}
          <Text style={[styles.stateTitle, { color: theme.inputText }]}>
            Nothing saved here yet.
          </Text>
          <Text style={[styles.stateBody, { color: theme.dividerText }]}>
            Tap the bookmark on a post to keep it here.
          </Text>
        </View>
      ) : loading ? null : (
        <FlatList<FeedPost | HnStory>
          {...LIST_VIRTUALIZATION_PROPS}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: dockHeight + insets.bottom + 12 },
          ]}
          data={data}
          keyExtractor={(item) =>
            isHnStory(item) ? `hn-${item.id}` : `post-${item.id}`
          }
          renderItem={({ item }) =>
            isHnStory(item) ? (
              <HnRow story={item} />
            ) : (
              <PostCard
                hasThreadChild={false}
                hasThreadParent={false}
                onMore={(post) =>
                  Alert.alert(
                    "Post options",
                    post.content ?? "Open the post to see more options."
                  )
                }
                onShare={(post) =>
                  void Share.share({
                    message: post.content ?? "Check this out on asocialmedia",
                  })
                }
                post={item}
                viewerId={user?.id}
              />
            )
          }
          showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
        />
      )}
      <MobileBottomNav onHeightChange={setDockHeight} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", flex: 1, justifyContent: "center" },
  countRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  countText: { fontFamily: "SofiaProReg", fontSize: 13 },
  hnMeta: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 8 },
  hnRow: { borderRadius: 14, borderWidth: 1, marginBottom: 8, padding: 14 },
  hnTitle: { fontFamily: "SofiaProMed", fontSize: 15, lineHeight: 20 },
  hnUrl: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 8 },
  list: { paddingBottom: 110 },
  loading: { paddingVertical: 20 },
  refresh: { fontFamily: "SofiaProMed", fontSize: 13 },
  retry: {
    borderColor: "#ff9500",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  retryText: { color: "#ff9500", fontFamily: "SofiaProMed", fontSize: 14 },
  root: { flex: 1 },
  state: {
    alignItems: "center",
    flex: 1,
    gap: 10,
    justifyContent: "center",
    padding: 32,
  },
  stateBody: { fontFamily: "SofiaProReg", fontSize: 14, textAlign: "center" },
  stateTitle: { fontFamily: "SofiaProBold", fontSize: 18, textAlign: "center" },
  subtitle: { fontFamily: "SofiaProReg", fontSize: 13, marginTop: 4 },
  title: { fontFamily: "SofiaProBold", fontSize: 24 },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
});
