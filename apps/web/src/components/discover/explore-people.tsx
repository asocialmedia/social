"use client";

import { Input } from "@asm/ui/shadui/input";
import noFollowImage from "@assets/general/nofollow.png";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import type React from "react";
import { useCallback, useMemo, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import useDebounce from "@/hooks/use-debounce";
import kyInstance from "@/lib/ky";

import ExplorePeopleSkeleton from "./explore-people-skeleton";
import ExploreUserCard from "./explore-user-card";
import type { ExploreUser } from "./explore-user-card";

// Re-exported for callers that want the skeleton without the data plumbing.
export { UserCardSkeleton } from "./explore-people-skeleton";

interface PeopleSearchResponse {
  users: ExploreUser[];
}

// How long typing must settle before the people search fires.
const PEOPLE_SEARCH_DEBOUNCE_MS = 300;

// The People tab: personalized suggestions for logged-in viewers (trending
// for guests), one featured recommended card on top, then everyone else in a
// discovery grid. The search bar scopes down to matching people without
// leaving the tab.
const ExplorePeople: React.FC = () => {
  const { user: sessionUser } = useSession();
  const isLoggedIn = Boolean(sessionUser);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, PEOPLE_SEARCH_DEBOUNCE_MS);
  const isSearching = debouncedSearch.trim().length > 0;

  // Discovery: ranked suggestions when signed in, trending otherwise. Both
  // audiences get the tab - guests just see the public ranking.
  const source: "suggested" | "trending" = isLoggedIn
    ? "suggested"
    : "trending";
  const {
    data: people,
    isFetching: isFetchingPeople,
    status: discoveryStatus,
  } = useQuery({
    enabled: !isSearching,
    placeholderData: (previousData) => previousData,
    queryFn: async (): Promise<ExploreUser[]> => {
      const res = await kyInstance
        .get(
          isLoggedIn ? "/api/users/suggested?limit=12" : "/api/users/trending"
        )
        .json<ExploreUser[]>();
      return res;
    },
    queryKey: ["explore-people", source],
    staleTime: 60 * 1000,
  });

  // Search: the explore search endpoint is open to guests and returns the
  // full user payload for name/username matches.
  const {
    data: searchData,
    isFetching: isFetchingSearch,
    status: searchStatus,
  } = useQuery({
    enabled: isSearching,
    placeholderData: (previousData) => previousData,
    queryFn: async (): Promise<ExploreUser[]> => {
      const res = await kyInstance
        .get("/api/explore/search", {
          searchParams: {
            q: debouncedSearch.trim(),
            tab: "people",
            take: "12",
          },
        })
        .json<PeopleSearchResponse>();
      return res.users;
    },
    queryKey: ["explore-people-search", debouncedSearch.trim()],
    staleTime: 60 * 1000,
  });

  const searchResults = useMemo(() => searchData ?? [], [searchData]);

  const handleRefreshPeople = useCallback(async () => {
    // Bypass the server-side cache; the fresh ranking replaces the query
    // data in place so the grid never flashes to skeletons.
    try {
      const res = await kyInstance
        .get("/api/users/suggested?limit=12&refresh=1")
        .json<ExploreUser[]>();
      queryClient.setQueryData(["explore-people", "suggested"], res);
    } catch {
      void queryClient.invalidateQueries({
        queryKey: ["explore-people", "suggested"],
      });
    }
  }, [queryClient]);

  const status = isSearching ? searchStatus : discoveryStatus;
  const showDiscoveryHeader = !isSearching;
  const isFetching = isSearching ? isFetchingSearch : isFetchingPeople;
  const list = isSearching ? searchResults : (people ?? []);
  const isEmpty = status === "success" && list.length === 0;
  let emptyHint = "Try a different name or @username";
  if (!isSearching) {
    emptyHint = isLoggedIn
      ? "Follow more people or post with tags to get personalized suggestions."
      : "Check back later for people trending on asocialmedia.";
  }

  const body: React.ReactNode = (() => {
    if (status === "pending") {
      return (
        <ExplorePeopleSkeleton variant={isSearching ? "search" : "discovery"} />
      );
    }
    if (status === "error") {
      return (
        <p className="text-destructive px-4 py-8 text-center">
          An error occurred while loading people.
        </p>
      );
    }
    if (isEmpty) {
      return (
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
            {isSearching
              ? `No people found for "${debouncedSearch.trim()}"`
              : "No suggestions yet"}
          </p>
          <p className="text-muted-foreground text-sm">{emptyHint}</p>
        </div>
      );
    }

    // One continuous masonry stream: the first ranked people carry the
    // highlighted Recommended treatment, the rest flow in untouched.
    const RECOMMENDED_COUNT = 5;
    const recommendedCount = isSearching
      ? 0
      : Math.min(RECOMMENDED_COUNT, list.length);

    return (
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        initial={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        {showDiscoveryHeader ? (
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {isLoggedIn ? "Recommended for you" : "Trending people"}
            </h2>
            {isLoggedIn ? (
              <button
                aria-label="Refresh suggestions"
                className="rail-3d-btn flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium disabled:opacity-50"
                disabled={isFetchingPeople}
                onClick={handleRefreshPeople}
                type="button"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${
                    isFetchingPeople ? "animate-spin" : ""
                  }`}
                />
                Refresh
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
          {list.map((entry, index) => (
            <ExploreUserCard
              className="mb-4"
              highlight={index < recommendedCount}
              key={entry.id}
              mutualFollowers={entry.mutualFollowers}
              user={entry}
            />
          ))}
        </div>
      </motion.div>
    );
  })();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="p-4"
        exit={{ opacity: 0, y: -8 }}
        initial={{ opacity: 0, y: 8 }}
        key={isSearching ? "people-search" : "people-discovery"}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        {/* People search bar: same recipe as the app's other search fields
            (shadui Input + icon slot), scoped to this tab, guests included. */}
        <div className="relative mb-4">
          {isFetching && isSearching ? (
            <span className="border-primary/30 border-t-primary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2" />
          ) : (
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          )}
          <Input
            aria-label="Search people"
            autoComplete="off"
            className="focus-visible:ring-primary h-10 py-2.5 pr-9 pl-9 transition-all duration-300 ease-in-out focus-visible:ring-2"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search people by name or @username"
            type="text"
            value={search}
          />
          {search ? (
            <button
              aria-label="Clear people search"
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-0.5 transition-colors"
              onClick={() => setSearch("")}
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {body}
      </motion.div>
    </AnimatePresence>
  );
};

export default ExplorePeople;
