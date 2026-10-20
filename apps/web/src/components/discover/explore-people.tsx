"use client";

import type { ExternalAuthor } from "@asm/protocols/contracts";
import { matchesAvoidedTopic } from "@asm/protocols/discovery";
import { Input } from "@asm/ui/shadui/input";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import noFollowImage from "@assets/general/nofollow.png";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import type React from "react";
import { useCallback, useMemo, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import useDebounce from "@/hooks/use-debounce";
import {
  useDiscoverySuggestions,
  useSearchLearning,
} from "@/hooks/use-discovery-suggestions";
import kyInstance from "@/lib/ky";
import { blueskyProfilePath } from "@/lib/protocols/paths";

import { ExploreNetworkAccount } from "./explore-network-cards";
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
  const network = useNetworkSettings();
  const isLoggedIn = Boolean(sessionUser);
  const suggestions = useDiscoverySuggestions();
  const learnSearch = useSearchLearning();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, PEOPLE_SEARCH_DEBOUNCE_MS);
  const isSearching = debouncedSearch.trim().length > 0;

  // Search: the explore search endpoint is open to guests and returns the
  // full user payload for name/username matches.
  const {
    data: searchData,
    isFetching: isFetchingSearch,
    status: searchStatus,
  } = useQuery({
    enabled: isSearching && network.ready,
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
    queryKey: [
      "explore-people-search",
      debouncedSearch.trim(),
      sessionUser?.id ?? "guest",
      network.scope,
    ],
    staleTime: 60 * 1000,
  });

  const searchResults = useMemo(() => searchData ?? [], [searchData]);

  const remoteSearch = useQuery({
    enabled: isSearching && network.ready && debouncedSearch.trim().length >= 2,
    queryFn: ({ signal }) =>
      kyInstance
        .get("/api/protocols/bluesky/search", {
          searchParams: { kind: "user", q: debouncedSearch.trim() },
          signal,
        })
        .json<{ profiles: ExternalAuthor[] }>(),
    queryKey: [
      "explore-people-network-search",
      debouncedSearch.trim(),
      sessionUser?.id ?? "guest",
      network.scope,
    ],
    retry: false,
    staleTime: 30_000,
  });
  const remoteAccounts = (remoteSearch.data?.profiles ?? [])
    .filter(
      (author) =>
        !matchesAvoidedTopic(
          `${author.displayName} ${author.description ?? ""}`,
          author.labels,
          network.settings.preferences.avoidedTopics
        )
    )
    .map((author) => ({
      avatarUrl: author.avatarUrl ?? null,
      bannerUrl: author.bannerUrl ?? null,
      displayName: author.displayName || author.handle,
      followers: author.upstreamCounts.followers ?? 0,
      following: false,
      handle: author.handle,
      href: blueskyProfilePath(author.id),
      id: author.id,
      reason: "Search match",
      source: "bluesky" as const,
    }));
  const handleRefreshPeople = useCallback(() => {
    void suggestions.refetch();
  }, [suggestions]);

  const status = isSearching ? searchStatus : suggestions.status;
  const showDiscoveryHeader = !isSearching;
  const isFetching = isSearching
    ? isFetchingSearch || remoteSearch.isFetching
    : suggestions.isFetching;
  const list = isSearching ? searchResults : [];
  const accounts = isSearching
    ? remoteAccounts
    : (suggestions.data?.accounts ?? []);
  const isEmpty =
    status === "success" &&
    list.length === 0 &&
    accounts.length === 0 &&
    !remoteSearch.isFetching;
  let emptyHint = "Try a different name or @username";
  if (!isSearching) {
    emptyHint = isLoggedIn
      ? "Follow more people or post with tags to get personalized suggestions."
      : "Check back later for people trending on asocialmedia.";
  }

  const body: React.ReactNode = (() => {
    if (status === "pending") {
      return (
        <ExplorePeopleSkeleton
          showSearch={isLoggedIn}
          variant={isSearching ? "search" : "discovery"}
        />
      );
    }
    if (status === "error" && !accounts.length) {
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
                disabled={suggestions.isFetching}
                onClick={handleRefreshPeople}
                type="button"
              >
                {suggestions.isFetching ? (
                  <Skeleton className="size-3.5 rounded-full" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Refresh
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] items-start gap-4">
          {accounts.map((account) => (
            <ExploreNetworkAccount
              key={`${account.source}:${account.id}`}
              account={account}
            />
          ))}
          {list.map((entry, index) => (
            <ExploreUserCard
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
        {/* Desktop people search complements the header search button. */}
        {isLoggedIn ? (
          <div className="relative mb-4 hidden md:block">
            {isFetching && isSearching ? (
              <Skeleton className="absolute top-1/2 left-3 size-4 -translate-y-1/2 rounded-full" />
            ) : (
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            )}
            <Input
              aria-label="Search people"
              autoComplete="off"
              className="focus-visible:ring-primary h-10 py-2.5 pr-9 pl-9 transition-all duration-300 ease-in-out focus-visible:ring-2"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void learnSearch(debouncedSearch.trim());
                }
              }}
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
        ) : null}

        {remoteSearch.isError && isSearching ? (
          <p className="text-muted-foreground mb-3 text-xs">
            Bluesky search is temporarily unavailable.
          </p>
        ) : null}
        {suggestions.data?.partial && !isSearching ? (
          <p className="text-muted-foreground mb-3 text-xs">
            Some network suggestions are temporarily unavailable.
          </p>
        ) : null}
        {body}
      </motion.div>
    </AnimatePresence>
  );
};

export default ExplorePeople;
