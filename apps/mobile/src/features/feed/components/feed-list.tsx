// One tab's feed list: thread-grouped post cards in a FlatList with
// pull-refresh, infinite scroll, per-tab scroll memory (restores position
// when switching tabs, like web's useFeedScrollMemory), the new-content
// pill overlay, and loading/error/empty/end states mirroring web HomeFeed.
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import noFeedImage from "@/assets/images/nofeed.png";
import notFoundImage from "@/assets/images/notfound.png";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import type { FeedVariant } from "../lib/feed-api";
import { groupPostsIntoThreads } from "../lib/feed-types";
import type { FeedPost, FeedThreadGroup } from "../lib/feed-types";
import { viewBatcher } from "../lib/view-batcher";
import { feedCache } from "../state/feed-store";
import { useFeedTab } from "../state/use-feed";
import { FeedSkeleton } from "./feed-skeleton";
import { MoreMenu } from "./more-menu";
import type { MoreAction } from "./more-menu";
import { NewContentPill } from "./new-content-pill";
import type { PillAuthor } from "./new-content-pill";
import { PostCard } from "./post-card";
import { ShareSheet } from "./share-sheet";

// Scroll offsets survive tab switches (and unmounts) like web's
// useFeedScrollMemory with memoryKey `home:${tab}`.
const scrollMemory = new Map<string, number>();

const EMPTY_COPY: Record<FeedVariant, { description: string; title: string }> =
  {
    following: {
      description:
        "Follow people you love and their fleets will land right here.",
      title: "No following fleets yet.",
    },
    latest: {
      description: "The latest Fleets will appear here.",
      title: "No Fleets yet.",
    },
    personalized: {
      description:
        "Your feed will learn from what you read, amplify, bookmark, and discuss.",
      title: "No personalized Fleets to show here.",
    },
    trending: {
      description: "Posts with the most aura will surface here.",
      title: "No trending fleets yet.",
    },
  };

interface FeedListProps {
  enabled: boolean;
  userId: string | undefined;
  variant: FeedVariant;
}

export function FeedList({ enabled, userId, variant }: FeedListProps) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const { user } = useSessionContext();
  const listRef = useRef<FlatList<FeedThreadGroup>>(null);
  const [sharePost, setSharePost] = useState<FeedPost | null>(null);
  const [morePost, setMorePost] = useState<FeedPost | null>(null);
  const [altVisibleIds, setAltVisibleIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [lastDismissed, setLastDismissed] = useState<string | null>(null);
  const {
    dismissPost,
    error,
    fetchNext,
    hasMore,
    newItems,
    posts,
    refresh,
    showNewPosts,
    status,
    undoDismiss,
  } = useFeedTab({ enabled, userId, variant });

  // Reconcile batched view counts into every cached tab, like web's
  // applyViewCountToCaches. All mounted tab lists share one batcher; only
  // clear the handler if it is still ours.
  useEffect(() => {
    const reconcile = (counts: Record<string, number>) => {
      for (const [postId, viewCount] of Object.entries(counts)) {
        feedCache.updatePostEverywhere(postId, { viewCount });
      }
    };
    viewBatcher.onFlush = reconcile;
    return () => {
      if (viewBatcher.onFlush === reconcile) {
        viewBatcher.onFlush = null;
      }
    };
  }, []);

  const handleMoreAction = (action: MoreAction) => {
    if (!morePost) {
      return;
    }
    if (action.type === "share") {
      setSharePost(morePost);
    } else if (action.type === "hide") {
      dismissPost(morePost.id);
      setLastDismissed(morePost.id);
    } else {
      setAltVisibleIds((current) => {
        const next = new Set(current);
        if (next.has(morePost.id)) {
          next.delete(morePost.id);
        } else {
          next.add(morePost.id);
        }
        return next;
      });
    }
  };

  // Restore this tab's scroll position when it (re)mounts with content.
  const memoryKey = `home:${variant}`;
  useEffect(() => {
    if (status !== "success" || posts.length === 0) {
      return;
    }
    const offset = scrollMemory.get(memoryKey) ?? 0;
    if (offset > 0) {
      const timer = setTimeout(() => {
        listRef.current?.scrollToOffset({ animated: false, offset });
      }, 60);
      return () => clearTimeout(timer);
    }
    // Runs when content lands; offsets are keyed per tab.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- one-shot restore on content arrival, not a subscription
  }, [memoryKey, posts.length, status]);

  // The undo banner auto-dismisses like web's toast.
  useEffect(() => {
    if (lastDismissed) {
      const timer = setTimeout(() => setLastDismissed(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [lastDismissed]);

  if (variant === "following" && !user) {
    const copy = EMPTY_COPY.following;
    return (
      <View style={styles.centerWrap}>
        <View
          style={[
            styles.prompt,
            { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
          ]}
        >
          <Text style={[styles.promptTitle, { color: theme.inputText }]}>
            Log in to see your feed
          </Text>
          <Text style={[styles.promptBody, { color: theme.dividerText }]}>
            {copy.description}
          </Text>
          <Pressable
            onPress={() => router.push("/(auth)/login")}
            style={styles.promptBtn}
          >
            <Text style={styles.promptBtnText}>Log in</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (status === "loading" || (status === "idle" && enabled)) {
    return <FeedSkeleton />;
  }

  if (status === "error" && posts.length === 0) {
    return (
      <View style={styles.centerWrap}>
        <Text style={[styles.errorTitle, { color: "#dc2626" }]}>
          An error occurred while loading posts.
        </Text>
        <Text style={[styles.errorBody, { color: theme.dividerText }]}>
          {error ?? "Please try again."}
        </Text>
        {__DEV__ ? (
          <Text style={[styles.errorBody, { color: theme.dividerText }]}>
            Dev build? Run `bun run dev:android --reverse-only` - the emulator
            loses its localhost ports on reboot.
          </Text>
        ) : null}
        <Pressable hitSlop={8} onPress={refresh} style={styles.retryRow}>
          <Text style={[styles.retryText, { color: theme.auxLink }]}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }

  if (status === "success" && posts.length === 0 && !hasMore) {
    const copy = EMPTY_COPY[variant];
    return (
      <View style={styles.centerWrap}>
        <Image
          contentFit="contain"
          source={noFeedImage}
          style={styles.emptyArt}
        />
        <Text style={[styles.emptyTitle, { color: theme.dividerText }]}>
          {copy.title}
        </Text>
        <Text style={[styles.emptyBody, { color: theme.dividerText }]}>
          {copy.description}
        </Text>
      </View>
    );
  }

  const groups = groupPostsIntoThreads(posts);
  const authors: PillAuthor[] = [
    ...new Map(
      newItems.map((post) => [
        post.userId,
        {
          avatarUrl: post.user?.avatarUrl,
          id: post.userId,
          username: post.user?.username,
        },
      ])
    ).values(),
  ];

  const showLoader = status === "loading-more";
  const showEnd = status === "success" && !hasMore && posts.length > 0;
  let footer: ReactNode = null;
  if (showLoader) {
    footer = (
      <View style={styles.footer}>
        <ActivityIndicator color={theme.dividerText} size="small" />
      </View>
    );
  } else if (showEnd) {
    footer = (
      <View style={styles.endWrap}>
        <Image
          contentFit="contain"
          source={notFoundImage}
          style={styles.endArt}
        />
        <Text style={[styles.endText, { color: theme.dividerText }]}>
          You&apos;re all caught up!
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.listWrap}>
      <FlatList
        data={groups}
        keyExtractor={(group) => group.id}
        onEndReached={fetchNext}
        onEndReachedThreshold={0.5}
        onMomentumScrollEnd={(event) => {
          scrollMemory.set(memoryKey, event.nativeEvent.contentOffset.y);
        }}
        onViewableItemsChanged={({ viewableItems }) => {
          const ids: string[] = [];
          for (const item of viewableItems) {
            const group = item.item as FeedThreadGroup | undefined;
            for (const post of group?.posts ?? []) {
              ids.push(post.id);
            }
          }
          if (ids.length > 0) {
            const apiBase = getApiBaseUrl();
            void (async () => {
              const cookie = await authClient.getCookie();
              for (const id of ids) {
                viewBatcher.mark(id, { apiBase, cookie });
              }
            })();
          }
        }}
        ref={listRef}
        refreshControl={
          <RefreshControl
            onRefresh={refresh}
            refreshing={status === "refreshing"}
            tintColor={theme.dividerText}
          />
        }
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        renderItem={({ item: group }) => (
          <View style={[styles.group, { borderBottomColor: theme.cardBorder }]}>
            {group.posts.map((post, index) => (
              <PostCard
                hasThreadChild={index < group.posts.length - 1}
                hasThreadParent={index > 0}
                key={post.id}
                onMore={setMorePost}
                onShare={setSharePost}
                post={post}
                showAlt={altVisibleIds.has(post.id)}
                showCommunityReason={
                  variant === "trending" || variant === "personalized"
                }
                viewerId={userId}
              />
            ))}
          </View>
        )}
        ListFooterComponent={footer}
      />
      {newItems.length > 0 ? (
        <NewContentPill
          authors={authors}
          count={newItems.length}
          onPress={() => {
            showNewPosts();
            listRef.current?.scrollToOffset({ animated: true, offset: 0 });
          }}
        />
      ) : null}
      {lastDismissed ? (
        <View style={styles.undoWrap} pointerEvents="box-none">
          <View
            style={[
              styles.undoBar,
              {
                backgroundColor: theme.cardBg,
                borderColor: theme.cardBorder,
              },
            ]}
          >
            <Text style={[styles.undoText, { color: theme.dividerText }]}>
              Post hidden
            </Text>
            <Pressable
              hitSlop={8}
              onPress={() => {
                if (lastDismissed) {
                  undoDismiss(lastDismissed);
                }
                setLastDismissed(null);
              }}
            >
              <Text style={[styles.undoAction, { color: theme.auxLink }]}>
                Undo
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <ShareSheet onClose={() => setSharePost(null)} post={sharePost} />
      <MoreMenu
        onAction={handleMoreAction}
        onClose={() => setMorePost(null)}
        post={morePost}
        showingAlt={morePost ? altVisibleIds.has(morePost.id) : false}
      />
    </View>
  );
}

export function clearFeedScrollMemory(): void {
  scrollMemory.clear();
}

const styles = StyleSheet.create({
  centerWrap: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  emptyArt: {
    height: 160,
    width: "100%",
  },
  emptyBody: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    marginTop: 8,
    textAlign: "center",
  },
  emptyTitle: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
    marginTop: 12,
    textAlign: "center",
  },
  endArt: {
    height: 160,
    width: "100%",
  },
  endText: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
    marginTop: 8,
    textAlign: "center",
  },
  endWrap: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 56,
  },
  errorBody: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    marginTop: 8,
    textAlign: "center",
  },
  errorTitle: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
    textAlign: "center",
  },
  footer: {
    paddingVertical: 20,
  },
  group: {
    borderBottomWidth: 1,
  },
  listWrap: {
    flex: 1,
    position: "relative",
  },
  prompt: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    maxWidth: 340,
    padding: 20,
    width: "100%",
  },
  promptBody: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    fontWeight: "normal",
    textAlign: "center",
  },
  promptBtn: {
    alignItems: "center",
    backgroundColor: "#ff9500",
    borderRadius: 9999,
    marginTop: 8,
    paddingVertical: 10,
  },
  promptBtnText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  promptTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 16,
    fontWeight: "normal",
    textAlign: "center",
  },
  retryRow: {
    marginTop: 12,
  },
  retryText: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
  undoAction: {
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  undoBar: {
    alignItems: "center",
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  undoText: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    fontWeight: "normal",
  },
  undoWrap: {
    alignItems: "center",
    bottom: 24,
    left: 0,
    position: "absolute",
    right: 0,
  },
});
