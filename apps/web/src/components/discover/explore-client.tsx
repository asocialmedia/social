"use client";

import type { PostData } from "@asm/db";
import { Input } from "@asm/ui/shadui/input";
import { Tabs, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import noFollowImage from "@assets/general/nofollow.png";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";

import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import useDebounce from "@/hooks/use-debounce";
import kyInstance from "@/lib/ky";

import ExploreMasonrySkeleton from "./explore-masonry-skeleton";
import ExplorePostCard from "./explore-post-card";
import ExploreUserCard from "./explore-user-card";
import type { ExploreUser } from "./explore-user-card";

type ExploreTab = "for-you" | "trending";

const TAB_META: Record<ExploreTab, string> = {
  "for-you": "For you",
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
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const tabParam = searchParams.get("tab");
  const activeTab: ExploreTab =
    tabParam === "trending" ? "trending" : "for-you";

  const handleTabChange = useCallback(
    (tab: string) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (tab === "for-you") {
        nextParams.delete("tab");
      } else {
        nextParams.set("tab", tab);
      }
      const query = nextParams.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams]
  );

  const queryKey = useMemo(
    () => ["explore-feed", activeTab, debouncedSearch],
    [activeTab, debouncedSearch]
  );

  const { data, status, isFetching } = useQuery({
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
      setSearch(e.target.value);
    },
    []
  );

  const handleClearSearch = useCallback(() => {
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
          className="columns-2 gap-4 p-4 sm:columns-3 xl:columns-4"
          exit={{ opacity: 0, y: -8 }}
          initial={{ opacity: 0, y: 8 }}
          key={debouncedSearch.trim() || "feed"}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {items}
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
        <MobileTopBar />
        <Tabs
          className="border-border/60 flex items-center gap-2 border-b px-3 py-1.5"
          onValueChange={handleTabChange}
          value={activeTab}
        >
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
            <div className="w-full max-w-[15rem]">
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
        </Tabs>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          className="hide-native-scrollbar h-full overflow-x-hidden overflow-y-auto"
          ref={feedScrollRef}
        >
          {body}
        </div>
        <FeedScrollbar containerRef={feedScrollRef} />
      </div>
    </div>
  );
};

export default ExploreClient;
