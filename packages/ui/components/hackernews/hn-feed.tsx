"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { HNApiResponse } from "@asm/aggregator/hackernews";
import {
  Briefcase,
  ChevronDown,
  HelpCircle,
  Newspaper,
  RefreshCw,
  Search,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "../../hooks/use-toast";
import { Button } from "../../shadui/button";
import { Card } from "../../shadui/card";
import { Tabs, TabsContent } from "../../shadui/tabs";
import {
  HNSidebar,
  SORT_OPTIONS,
  type SortOption,
  TAB_CONFIG,
} from "./hn-sidebar";
import { HNStory } from "./hn-story";
import { MobileSidebarToggle } from "./mobile/mobile-sidebar-toggle";
import { hackerNewsMutations } from "./mutations";

const ITEMS_PER_PAGE = 20;

const contentVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

export function HNFeed() {
  const [searchInput, setSearchInput] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>(SORT_OPTIONS.SCORE);
  const [activeTab, setActiveTab] = useState("all");
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isLoading,
    isError,
    isFetching,
    isFetchingNextPage,
  } = useInfiniteQuery<HNApiResponse>({
    queryKey: ["hackernews", searchInput, sortBy, activeTab],
    queryFn: async ({ pageParam = 0 }) => {
      const response = await hackerNewsMutations.fetchStories({
        page: pageParam as number,
        limit: ITEMS_PER_PAGE,
        search: searchInput || undefined,
        sort: sortBy,
        type: activeTab,
      });
      return response;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.stories.length / ITEMS_PER_PAGE : undefined,
    staleTime: 1000 * 60 * 5,
  });

  const handleRefresh = async () => {
    try {
      await hackerNewsMutations.refreshCache();
      await queryClient.invalidateQueries({ queryKey: ["hackernews"] });
      toast({
        title: "Refreshed",
        description: "Stories have been updated",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: (error as Error)?.message || "Failed to refresh stories",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (isError) {
      toast({
        title: "Error",
        description: "Failed to fetch stories. Please try again later.",
        variant: "destructive",
      });
    }
  }, [isError, toast]);

  const sortedStories = useMemo(() => {
    const stories = data?.pages.flatMap((page) => page.stories) ?? [];
    return [...stories].sort((a, b) => {
      switch (sortBy) {
        case SORT_OPTIONS.SCORE:
          return b.score - a.score;
        case SORT_OPTIONS.TIME:
          return b.time - a.time;
        case SORT_OPTIONS.COMMENTS:
          return b.descendants - a.descendants;
        default:
          return 0;
      }
    });
  }, [data?.pages, sortBy]);

  const totalPoints = useMemo(
    () => sortedStories.reduce((acc, story) => acc + story.score, 0),
    [sortedStories]
  );

  const totalStories = data?.pages[0]?.total || 0;

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    queryClient.resetQueries({ queryKey: ["hackernews"] });
  };

  const handleSortChange = (value: SortOption) => {
    setSortBy(value);
    queryClient.resetQueries({ queryKey: ["hackernews"] });
  };

  const handleLoadMore = async () => {
    try {
      setIsLoadingMore(true);
      await fetchNextPage();
    } catch {
      toast({
        title: "Error",
        description: "Failed to load more stories",
        variant: "destructive",
      });
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-background/50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex gap-8">
          {/* Desktop Sidebar */}
          <div className="hidden w-80 shrink-0 md:block">
            <div className="fixed w-80">
              <HNSidebar
                activeTab={activeTab}
                isFetching={isFetching}
                onRefreshAction={handleRefresh}
                searchInput={searchInput}
                setActiveTabAction={handleTabChange}
                setSearchInputAction={setSearchInput}
                setSortByAction={handleSortChange}
                sortBy={sortBy}
                totalPoints={totalPoints}
                totalStories={totalStories}
              />
            </div>
          </div>

          <div className="md:hidden">
            <MobileSidebarToggle>
              <HNSidebar
                activeTab={activeTab}
                isFetching={isFetching}
                onRefreshAction={handleRefresh}
                searchInput={searchInput}
                setActiveTabAction={handleTabChange}
                setSearchInputAction={setSearchInput}
                setSortByAction={handleSortChange}
                sortBy={sortBy}
                totalPoints={totalPoints}
                totalStories={totalStories}
              />
            </MobileSidebarToggle>
          </div>

          <motion.div
            animate="visible"
            className="flex-1"
            initial="hidden"
            variants={contentVariants}
          >
            <Tabs onValueChange={handleTabChange} value={activeTab}>
              {TAB_CONFIG.map((tab) => (
                <TabsContent
                  className="mt-0 focus-visible:outline-hidden focus-visible:ring-0"
                  key={tab.id}
                  value={tab.id}
                >
                  {isLoading ? (
                    <LoadingState />
                  ) : (
                    <AnimatePresence mode="popLayout">
                      <div className="space-y-4">
                        {sortedStories.length > 0 ? (
                          <>
                            <div className="divide-y divide-border/50">
                              {sortedStories.map((story) => (
                                <div className="relative" key={story.id}>
                                  <motion.div
                                    animate={{ opacity: 1, y: 0 }}
                                    className="relative"
                                    exit={{ opacity: 0, y: -20 }}
                                    initial={{ opacity: 0, y: 20 }}
                                    transition={{
                                      type: "spring",
                                      stiffness: 100,
                                    }}
                                  >
                                    <HNStory story={story} />
                                  </motion.div>
                                </div>
                              ))}
                            </div>

                            {hasNextPage && (
                              <motion.div
                                animate={{ opacity: 1 }}
                                className="flex justify-center py-8"
                                initial={{ opacity: 0 }}
                              >
                                <Button
                                  className="relative overflow-hidden bg-orange-500 text-white hover:bg-orange-600"
                                  disabled={isLoadingMore || isFetchingNextPage}
                                  onClick={handleLoadMore}
                                  size="lg"
                                >
                                  {isLoadingMore || isFetchingNextPage ? (
                                    <>
                                      <motion.div
                                        animate={{
                                          x: ["0%", "100%"],
                                          opacity: [0.5, 0],
                                        }}
                                        className="absolute inset-0 bg-orange-600"
                                        transition={{
                                          duration: 1,
                                          repeat: Number.POSITIVE_INFINITY,
                                        }}
                                      />
                                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                      Loading more stories...
                                    </>
                                  ) : (
                                    <>
                                      Load More Stories
                                      <ChevronDown className="ml-2 h-4 w-4" />
                                    </>
                                  )}
                                </Button>
                              </motion.div>
                            )}
                          </>
                        ) : (
                          <EmptyState onRefresh={handleRefresh} type={tab.id} />
                        )}
                      </div>
                    </AnimatePresence>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      {[...new Array(5)].map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton loading items don't have unique IDs
        <Card className="bg-background/50 p-4 backdrop-blur-sm" key={i}>
          <div className="space-y-3">
            <div className="h-6 w-3/4 animate-pulse rounded-sm bg-muted" />
            <div className="h-4 w-1/4 animate-pulse rounded-sm bg-muted" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function EmptyState({
  type,
  onRefresh,
}: {
  type: string;
  onRefresh: () => void;
}) {
  const messages = {
    job: {
      title: "No jobs available",
      description:
        "There are currently no job postings available on HackerNews.",
    },
    show: {
      title: "No Show HN posts",
      description: "There are currently no Show HN posts available.",
    },
    ask: {
      title: "No Ask HN posts",
      description: "There are currently no Ask HN questions available.",
    },
    default: {
      title: "No stories available",
      description: "There are currently no stories matching your criteria.",
    },
  };

  const message = messages[type as keyof typeof messages] || messages.default;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-16"
      initial={{ opacity: 0, y: 20 }}
    >
      <div className="relative rounded-full bg-orange-500/10 p-4">
        {type === "job" && <Briefcase className="h-8 w-8 text-orange-500" />}
        {type === "show" && <Search className="h-8 w-8 text-orange-500" />}
        {type === "ask" && <HelpCircle className="h-8 w-8 text-orange-500" />}
        {!["job", "show", "ask"].includes(type) && (
          <Newspaper className="h-8 w-8 text-orange-500" />
        )}
      </div>
      <h3 className="mt-4 font-semibold text-lg">{message.title}</h3>
      <p className="mt-2 text-muted-foreground text-sm">
        {message.description}
      </p>
      <Button
        className="mt-4 hover:bg-orange-500/10 hover:text-orange-500"
        onClick={onRefresh}
        variant="outline"
      >
        <RefreshCw className="mr-2 h-4 w-4" />
        Refresh
      </Button>
    </motion.div>
  );
}
