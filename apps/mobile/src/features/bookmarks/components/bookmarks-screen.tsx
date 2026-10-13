import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Clapperboard, Heart, Newspaper, Terminal } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import noBookmarksImage from "@/assets/images/nonotibook.png";
import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { useComposerStore } from "@/features/composer/state/composer-store";
import {
  FeedSkeleton,
  FeedSkeletonCard,
} from "@/features/feed/components/feed-skeleton";
import { FeedTabs } from "@/features/feed/components/feed-tabs";
import { MoreMenu } from "@/features/feed/components/more-menu";
import type { MenuAnchor } from "@/features/feed/components/more-menu";
import { PostCard } from "@/features/feed/components/post-card";
import { ShareSheet } from "@/features/feed/components/share-sheet";
import { usePostOverflow } from "@/features/feed/components/use-post-overflow";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { GustRowCard } from "@/features/gusts/components/gust-row-card";
import { HnFeedSkeleton } from "@/features/hackernews/components/hn-feed-skeleton";
import { HnStoryCard } from "@/features/hackernews/components/hn-story-card";
import { setHnBookmark } from "@/features/hackernews/lib/hackernews-api";
import type { HnStory } from "@/features/hackernews/lib/hackernews-api";
import { MobileBottomNav } from "@/features/home/components/mobile-bottom-nav";
import { MobileHeader } from "@/features/home/components/mobile-header";
import { SettingsButton } from "@/features/settings/components/settings-ui";
import { getApiBaseUrl } from "@/lib/api-env";
import { LIST_VIRTUALIZATION_PROPS } from "@/lib/list-virtualization";
import { ResourceCache } from "@/lib/resource-cache";
import { SHOWS_SCROLL_INDICATOR } from "@/lib/scroll-indicator";
import { swipeTab } from "@/lib/tab-swipe";
import { useCachedResource } from "@/lib/use-cached-resource";
import { useTabSwipe } from "@/lib/use-tab-swipe";
import { useAppTheme } from "@/theme";

import {
  fetchBookmarkedHn,
  fetchBookmarkedPage,
  fetchLikedPage,
} from "../lib/bookmarks-api";

type BookmarkTab = "posts" | "gusts" | "hackernews" | "likes";
type BookmarkItem = FeedPost | HnStory;
interface BookmarkPage {
  items: BookmarkItem[];
  nextCursor: string | null;
}
const TABS = [
  { icon: Newspaper, label: "Posts", value: "posts" },
  { icon: Clapperboard, label: "Gusts", value: "gusts" },
  { icon: Terminal, label: "HackerNews", value: "hackernews" },
  { icon: Heart, label: "Likes", value: "likes" },
] as const;
const TAB_ORDER = ["posts", "gusts", "hackernews", "likes"] as const;
const cache = new ResourceCache<BookmarkPage>({
  maxEntries: 20,
  staleMs: 60_000,
});
const isHnStory = (item: BookmarkItem): item is HnStory => "title" in item;

async function loadPage(
  tab: BookmarkTab,
  cursor?: string
): Promise<BookmarkPage> {
  const options = {
    apiBase: getApiBaseUrl(),
    cookie: await authClient.getCookie(),
  };
  if (tab === "hackernews") {
    return { items: await fetchBookmarkedHn(options), nextCursor: null };
  }
  const page =
    tab === "likes"
      ? await fetchLikedPage(options, cursor)
      : await fetchBookmarkedPage(tab, options, cursor);
  return { items: page.posts, nextCursor: page.nextCursor };
}

const reshareHn = (story: HnStory) =>
  useComposerStore.getState().openWithContext({
    kind: "hn",
    story: {
      by: story.by,
      descendants: story.comments,
      score: story.score,
      storyId: story.id,
      time: story.time,
      title: story.title,
      url: story.url,
    },
  });

export function BookmarksScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { user, isPending } = useSessionContext();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<BookmarkTab>("posts");
  const [dockHeight, setDockHeight] = useState(56);
  const [loadingMoreKeys, setLoadingMoreKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [now, setNow] = useState(Date.now);
  const [menu, setMenu] = useState<{
    anchor: MenuAnchor;
    post: FeedPost;
  } | null>(null);
  const [sharePost, setSharePost] = useState<FeedPost | null>(null);
  const listRef = useRef<FlatList<BookmarkItem>>(null);
  const scrollOffsets = useRef(new Map<BookmarkTab, number>());
  const pendingPages = useRef(new Set<string>());
  const key = user ? `${getApiBaseUrl()}:${user.id}:${tab}` : null;
  const loadingMore = key !== null && loadingMoreKeys.has(key);
  const loader = useCallback(() => loadPage(tab), [tab]);
  const resource = useCachedResource(cache, key, loader);
  useEffect(() => {
    if (!isPending && !user) {
      router.replace("/(auth)/login");
    }
  }, [isPending, router, user]);
  useEffect(() => {
    listRef.current?.scrollToOffset({
      animated: false,
      offset: scrollOffsets.current.get(tab) ?? 0,
    });
  }, [tab]);
  const navigateTab = useCallback(
    (direction: -1 | 1) =>
      setTab((current) => swipeTab(TAB_ORDER, current, direction)),
    []
  );
  const swipe = useTabSwipe(navigateTab);
  const updateRows = useCallback(
    (id: string, changes?: Partial<FeedPost>) => {
      if (!user) {
        return;
      }
      for (const value of TAB_ORDER) {
        const cacheKey = `${getApiBaseUrl()}:${user.id}:${value}`;
        const page = cache.read(cacheKey).data;
        if (page) {
          cache.setData(cacheKey, {
            ...page,
            items: page.items.flatMap((item) => {
              if (isHnStory(item) || item.id !== id) {
                return [item];
              }
              return changes ? [{ ...item, ...changes }] : [];
            }),
          });
        }
      }
    },
    [user]
  );
  const overflow = usePostOverflow({
    onDeleted: (id) => updateRows(id),
    onHide: (post) => updateRows(post.id),
    onModerated: (id, next) => updateRows(id, next),
    onTagsSaved: () => {
      void resource.reload();
    },
    viewerId: user?.id ?? null,
  });
  const more = useCallback(
    (post: FeedPost, anchor: MenuAnchor) => setMenu({ anchor, post }),
    []
  );
  const removeHn = async (story: HnStory) => {
    if (!key) {
      return;
    }
    const ok = await setHnBookmark(story.id, false, {
      apiBase: getApiBaseUrl(),
      cookie: await authClient.getCookie(),
    });
    const page = cache.read(key).data;
    if (ok && page) {
      cache.setData(key, {
        ...page,
        items: page.items.filter((item) => item.id !== story.id),
      });
    }
    if (!ok) {
      toast({
        description: "Try again.",
        title: "Couldn't remove bookmark",
        variant: "destructive",
      });
    }
  };
  const loadMore = async () => {
    const cursor = resource.data?.nextCursor;
    if (!key || !cursor || pendingPages.current.has(key)) {
      return;
    }
    const requestKey = key;
    pendingPages.current.add(requestKey);
    setLoadingMoreKeys((current) => new Set(current).add(requestKey));
    try {
      const next = await loadPage(tab, cursor);
      const current = cache.read(requestKey).data;
      if (current) {
        const seen = new Set(current.items.map((item) => item.id));
        cache.setData(requestKey, {
          items: [
            ...current.items,
            ...next.items.filter((item) => !seen.has(item.id)),
          ],
          nextCursor: next.nextCursor,
        });
      }
    } catch {
      toast({
        description: "Scroll again to retry.",
        title: "Couldn't load more bookmarks",
      });
    }
    pendingPages.current.delete(requestKey);
    setLoadingMoreKeys(
      (current) => new Set([...current].filter((value) => value !== requestKey))
    );
  };
  let empty: React.ReactNode;
  if (isPending || (resource.data === null && resource.status !== "error")) {
    empty = tab === "hackernews" ? <HnFeedSkeleton /> : <FeedSkeleton />;
  } else if (resource.error) {
    empty = (
      <View style={styles.empty}>
        <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
          {resource.error}
        </Text>
        <SettingsButton
          label="Try again"
          tone="gray"
          onPress={() => {
            void resource.reload();
          }}
        />
      </View>
    );
  } else {
    const liked = tab === "likes";
    empty = (
      <View style={styles.empty}>
        <Image
          source={noBookmarksImage}
          contentFit="contain"
          style={{ height: 160, width: 240 }}
        />
        <Text style={[styles.emptyTitle, { color: theme.inputText }]}>
          {liked ? "No liked posts yet" : "No bookmarks yet"}
        </Text>
        <Text style={[styles.emptyCopy, { color: theme.dividerText }]}>
          {liked
            ? "Posts you amplify will show up here."
            : "Bookmark posts, gusts and stories to keep them here."}
        </Text>
      </View>
    );
  }
  const renderRow = ({ item }: { item: BookmarkItem }) => {
    let content: React.ReactNode;
    if (isHnStory(item)) {
      content = (
        <HnStoryCard
          story={item}
          now={now}
          bookmarked
          onReshare={reshareHn}
          onToggleBookmark={(story) => {
            void removeHn(story);
          }}
          onVisit={() => setNow(Date.now())}
        />
      );
    } else if (item.isGust) {
      content = <GustRowCard post={item} />;
    } else {
      content = (
        <PostCard
          post={item}
          viewerId={user?.id}
          hasThreadChild={false}
          hasThreadParent={false}
          onMore={more}
          onShare={setSharePost}
        />
      );
    }
    return (
      <View
        style={{
          borderBottomColor: theme.cardBorder,
          borderBottomWidth: StyleSheet.hairlineWidth,
        }}
      >
        {content}
      </View>
    );
  };
  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <MobileHeader
        hideOnScroll={false}
        user={user ? { ...user, username: user.username ?? user.name } : null}
      />
      <FeedTabs
        active={tab}
        tabs={TABS}
        onChange={setTab}
        alignment="center"
        renderLabel={(definition, selected) => {
          const Icon =
            TABS.find((value) => value.value === definition.value)?.icon ??
            Newspaper;
          return (
            <View style={styles.tabLabel}>
              <Icon
                size={16}
                color={selected ? theme.inputText : theme.dividerText}
              />
              {selected ? (
                <Text style={[styles.tabText, { color: theme.inputText }]}>
                  {definition.label}
                </Text>
              ) : null}
            </View>
          );
        }}
      />
      <GestureDetector gesture={swipe}>
        <View style={styles.root}>
          <FlatList
            ref={listRef}
            onScroll={(event) =>
              scrollOffsets.current.set(tab, event.nativeEvent.contentOffset.y)
            }
            scrollEventThrottle={16}
            {...LIST_VIRTUALIZATION_PROPS}
            data={resource.data?.items ?? []}
            keyExtractor={(item) =>
              `${isHnStory(item) ? "hn" : "post"}-${item.id}`
            }
            contentContainerStyle={{
              paddingBottom: dockHeight + insets.bottom + 24,
            }}
            ListEmptyComponent={empty}
            ListFooterComponent={loadingMore ? <FeedSkeletonCard /> : null}
            showsVerticalScrollIndicator={SHOWS_SCROLL_INDICATOR}
            onEndReached={() => {
              void loadMore();
            }}
            onEndReachedThreshold={0.5}
            renderItem={renderRow}
          />
        </View>
      </GestureDetector>
      <MobileBottomNav onHeightChange={setDockHeight} />
      <ShareSheet
        post={sharePost}
        onClose={() => setSharePost(null)}
        title="Share post"
        description="Share this post with your network"
      />
      <MoreMenu
        anchor={menu?.anchor ?? null}
        entries={
          menu
            ? overflow.entriesFor(menu.post, {
                showCaptions: false,
                showingAlt: false,
              })
            : []
        }
        onAction={(action) => {
          if (menu) {
            overflow.onAction(action, menu.post);
          }
          setMenu(null);
        }}
        onClose={() => setMenu(null)}
      />
      {overflow.dialogs}
    </View>
  );
}
const styles = StyleSheet.create({
  empty: { alignItems: "center", gap: 12, padding: 32, paddingVertical: 48 },
  emptyCopy: { fontFamily: "SofiaProReg", fontSize: 13, textAlign: "center" },
  emptyTitle: { fontFamily: "SofiaProMed", fontSize: 15 },
  root: { flex: 1 },
  tabLabel: { alignItems: "center", flexDirection: "row", gap: 6 },
  tabText: { fontFamily: "SofiaProMed", fontSize: 14 },
});
