"use client";

import type { PostData, PostsPage } from "@asm/db";
import { Input } from "@asm/ui/shadui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import noFollowImage from "@assets/general/nofollow.png";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { AuthPromptCard } from "@/components/auth/auth-prompt-card";
import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import useDebounce from "@/hooks/use-debounce";
import kyInstance from "@/lib/ky";

import { ExploreGustsGrid } from "./explore-gusts-grid";
import { ExploreGustsRail } from "./explore-gusts-rail";
import ExploreMasonrySkeleton from "./explore-masonry-skeleton";
import ExplorePostCard from "./explore-post-card";
import ExploreUserCard from "./explore-user-card";
import type { ExploreUser } from "./explore-user-card";

type ExploreTab = "for-you" | "trending" | "gusts";

const TAB_META: Record<ExploreTab, string> = {
  "for-you": "For you",
  gusts: "Gusts",
  trending: "Trending",
};

interface FeedData {
  posts: PostData[];
  users: ExploreUser[];
}

const USER_INTERVAL = 6;

const ExploreClient: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { user: sessionUser } = useSession();
  const isLoggedIn = Boolean(sessionUser);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const tabParam = searchParams.get("tab");
  let activeTab: ExploreTab;
  if (tabParam === "trending") {
    activeTab = "trending";
  } else if (tabParam === "gusts") {
    activeTab = "gusts";
  } else if (tabParam === "for-you") {
    activeTab = "for-you";
  } else if (isLoggedIn) {
    activeTab = "for-you";
  } else {
    // Guests default to the open Trending tab; For you is behind auth.
    activeTab = "trending";
  }

  // "For you" needs an account (guests see the login card); Trending and Gusts stay open.
  const showForYou = isLoggedIn;
  const canQuery = isLoggedIn || activeTab !== "for-you";

  // Track the newest post id so a quiet poll can surface a "new posts" pill
  // without disturbing the grid or the user's scroll position. Declared early
  // so the tab/search handlers can clear it.
  const newestIdRef = useRef<string | null>(null);
  const [newPostsCount, setNewPostsCount] = useState(0);
  const feedRootRef = useRef<HTMLDivElement>(null);

  const handleTabChange = useCallback(
    (tab: string) => {
      setNewPostsCount(0);
      newestIdRef.current = null;
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("tab", tab);
      const query = nextParams.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams]
  );

  // Fetch top Gusts for the trending rail
  const { data: gustsData } = useQuery({
    queryFn: async () => {
      const res = await kyInstance
        .get("/api/gusts", { searchParams: { take: "8" } })
        .json<PostsPage>();
      return res.posts;
    },
    queryKey: ["explore-top-gusts"],
    staleTime: 60 * 1000,
  });

  const queryKey = useMemo(
    () => ["explore-feed", activeTab, debouncedSearch],
    [activeTab, debouncedSearch]
  );

  const { data, status, isFetching } = useQuery({
    enabled: canQuery && activeTab !== "gusts",
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      if (debouncedSearch.trim()) {
        const result = await kyInstance
          .get("/api/explore/search", {
            searchParams: {
              q: debouncedSearch.trim(),
              tab: activeTab,
              take: "20",
            },
          })
          .json<FeedData>();
        return result satisfies FeedData;
      }

      const [posts, users] = await Promise.all([
        kyInstance.get(`/api/posts/${activeTab}`).json<{ posts: PostData[] }>(),
        kyInstance
          .get(
            `/api/users/${activeTab === "for-you" ? "suggested" : "trending"}`
          )
          .json<ExploreUser[]>(),
      ]);
      return { posts: posts.posts, users } satisfies FeedData;
    },
    queryKey,
    staleTime: 60 * 1000,
  });

  const posts = useMemo(() => data?.posts ?? [], [data]);
  const users = useMemo(() => data?.users ?? [], [data]);
  const gusts = useMemo(() => gustsData ?? [], [gustsData]);

  // Poll every 45s for the newest post in the active feed. When a brand-new
  // post appears, reveal the pill; the grid is refetched only when tapped.
  useEffect(() => {
    // A feed identity change (tab or search) must not carry stale state over:
    // re-baseline the newest id against the posts actually showing here. The
    // pill count is cleared when the identity changes (tab/search handlers).
    newestIdRef.current = posts.length > 0 ? posts[0].id : null;

    if (activeTab === "gusts" || debouncedSearch.trim()) {
      return;
    }
    const identity = `${activeTab}:${debouncedSearch.trim()}`;
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const fresh = await kyInstance
            .get(`/api/posts/${activeTab}`)
            .json<{ posts: PostData[] }>();
          // Ignore responses that started for a previous identity (a tab switch
          // could land while a request is in flight).
          if (identity !== `${activeTab}:${debouncedSearch.trim()}`) {
            return;
          }
          const newest = fresh.posts[0]?.id;
          if (newest && newest !== newestIdRef.current) {
            newestIdRef.current = newest;
            const knownIds = new Set(posts.map((p) => p.id));
            let count = 0;
            for (const post of fresh.posts) {
              if (knownIds.has(post.id)) {
                break;
              }
              count += 1;
            }
            if (count > 0) {
              setNewPostsCount(count);
            }
          }
        } catch {
          // Best-effort polling; ignore transient failures
        }
      })();
    }, 45 * 1000);
    return () => window.clearInterval(interval);
  }, [activeTab, debouncedSearch, posts]);

  const showNewPosts = useCallback(() => {
    setNewPostsCount(0);
    void queryClient.refetchQueries({ queryKey });
    let node: HTMLElement | null = feedRootRef.current;
    while (node) {
      if (node.scrollHeight > node.clientHeight) {
        node.scrollTo({ behavior: "smooth", top: 0 });
        break;
      }
      node = node.parentElement;
    }
  }, [queryClient, queryKey]);

  const handleFollowed = useCallback(
    (userId: string) => {
      queryClient.setQueryData<FeedData>(queryKey, (old) =>
        old
          ? { ...old, users: old.users.filter((user) => user.id !== userId) }
          : old
      );
    },
    [queryClient, queryKey]
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setNewPostsCount(0);
      newestIdRef.current = null;
      setSearch(e.target.value);
    },
    []
  );

  const handleClearSearch = useCallback(() => {
    setNewPostsCount(0);
    newestIdRef.current = null;
    setSearch("");
  }, []);

  // Interleave user cards into the post stream (Pinterest-style).
  const items = useMemo(() => {
    const result: React.ReactNode[] = [];
    let postIndex = 0;
    let userIndex = 0;

    for (let slot = 0; postIndex < posts.length; slot += 1) {
      if (
        userIndex < users.length &&
        slot % USER_INTERVAL === USER_INTERVAL - 1
      ) {
        const user = users[userIndex];
        result.push(
          <ExploreUserCard
            key={`user-${user.id}`}
            onFollowed={handleFollowed}
            user={user}
          />
        );
        userIndex += 1;
      } else {
        const post = posts[postIndex];
        result.push(<ExplorePostCard key={`post-${post.id}`} post={post} />);
        postIndex += 1;
      }
    }

    while (userIndex < users.length) {
      const user = users[userIndex];
      result.push(
        <ExploreUserCard
          key={`user-${user.id}`}
          onFollowed={handleFollowed}
          user={user}
        />
      );
      userIndex += 1;
    }

    return result;
  }, [handleFollowed, posts, users]);

  let body: React.ReactNode;
  if (status === "pending") {
    body = <ExploreMasonrySkeleton />;
  } else if (status === "error") {
    body = (
      <p className="text-destructive px-4 py-8 text-center">
        An error occurred while loading content.
      </p>
    );
  } else if (items.length === 0) {
    body = (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <Image
          alt=""
          className="h-40 w-auto object-contain"
          draggable={false}
          height={1024}
          src={noFollowImage}
          width={1536}
        />
        <p className="font-medium">
          {debouncedSearch.trim()
            ? `No results for "${debouncedSearch.trim()}"`
            : "Nothing here yet"}
        </p>
        <p className="text-muted-foreground text-sm">
          {debouncedSearch.trim()
            ? "Try a different name or topic"
            : "Follow people to see their fleets here."}
        </p>
      </div>
    );
  } else {
    body = (
      <AnimatePresence mode="wait">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="p-4"
          exit={{ opacity: 0, y: -8 }}
          initial={{ opacity: 0, y: 8 }}
          key={debouncedSearch.trim() || "feed"}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {/* Top Gusts rail on explore feed */}
          {!debouncedSearch.trim() && gusts.length > 0 ? (
            <ExploreGustsRail
              gusts={gusts}
              onViewAll={() => handleTabChange("gusts")}
            />
          ) : null}

          {/* Masonry Post Stream */}
          <div className="columns-2 gap-4 sm:columns-3 xl:columns-4">
            {items}
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <Tabs
      className="flex min-h-0 flex-1 flex-col"
      onValueChange={handleTabChange}
      value={activeTab}
    >
      <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
        <MobileTopBar />
        <div className="border-border/60 flex items-center gap-2 border-b px-3 py-1.5">
          <TabsList className="flex h-full min-w-0 flex-1 items-center justify-center gap-0 bg-transparent p-0 md:justify-start">
            {(Object.keys(TAB_META) as ExploreTab[]).map((tab) => (
              <TabsTrigger
                className={`${TAB_TRIGGER_CLASS} flex-1`}
                key={tab}
                value={tab}
              >
                {TAB_META[tab]}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="relative ml-auto hidden min-w-0 items-center gap-2 md:flex">
            <div className="w-full max-w-60">
              <div className="relative">
                {isFetching && debouncedSearch.trim() ? (
                  <span className="border-primary/30 border-t-primary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2" />
                ) : (
                  <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                )}
                <Input
                  aria-label="Search explore"
                  autoComplete="off"
                  className="focus-visible:ring-primary h-10 py-2.5 pr-4 pl-9 transition-all duration-300 ease-in-out focus-visible:ring-2"
                  onChange={handleSearchChange}
                  placeholder="Search explore"
                  type="text"
                  value={search}
                />
                {search ? (
                  <button
                    aria-label="Clear search"
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-0.5 transition-colors"
                    onClick={handleClearSearch}
                    type="button"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="relative h-full" ref={feedRootRef}>
          {newPostsCount > 0 &&
          activeTab !== "gusts" &&
          !debouncedSearch.trim() ? (
            <div className="pointer-events-none sticky top-3 z-20 flex justify-center">
              <button
                className="rail-3d-btn pointer-events-auto flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium"
                onClick={showNewPosts}
                type="button"
              >
                <RefreshCw className="size-4" />
                {newPostsCount} new post{newPostsCount === 1 ? "" : "s"}
              </button>
            </div>
          ) : null}
          <div
            className={`hide-native-scrollbar h-full overflow-x-hidden overflow-y-auto ${
              isLoggedIn ? "pb-16 lg:pb-0" : "pb-44 lg:pb-20"
            }`}
            ref={feedScrollRef}
          >
            <TabsContent className="mt-0" value="for-you">
              {showForYou ? (
                body
              ) : (
                <div className="px-4 py-10">
                  <AuthPromptCard
                    className="mx-auto w-full max-w-md"
                    description="Sign in to see fleets curated just for you."
                    imageSize={128}
                    title="Log in to see your feed"
                  />
                </div>
              )}
            </TabsContent>
            <TabsContent className="mt-0" value="trending">
              {body}
            </TabsContent>
            <TabsContent className="mt-0" value="gusts">
              <ExploreGustsGrid />
            </TabsContent>
          </div>
        </div>
        <FeedScrollbar containerRef={feedScrollRef} />
      </div>
    </Tabs>
  );
};

export default ExploreClient;
