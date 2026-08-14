"use client";

import type { UserData } from "@asm/db";
import { Tabs, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useRef, useState } from "react";

import { HN_SORT_OPTIONS, HNFeed } from "@/components/hackernews/hn-feed";
import type { HNSortOption } from "@/components/hackernews/hn-feed";
import HnRightSideBar from "@/components/hackernews/hn-right-side-bar";
import { HNSearchBar } from "@/components/hackernews/hn-search-bar";
import type { HNFilterId } from "@/components/hackernews/hn-search-bar";
import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import MobileBottomNav from "@/components/layouts/mobile/mobile-bottom-nav";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import useDebounce from "@/hooks/use-debounce";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";

interface ClientHackerNewsProps {
  userData: UserData;
}

const ClientHackerNews: React.FC<ClientHackerNewsProps> = ({ userData }) => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const sortParam = searchParams.get("sort");
  let sortBy: HNSortOption = HN_SORT_OPTIONS.SCORE;
  if (sortParam === "time") {
    sortBy = HN_SORT_OPTIONS.TIME;
  } else if (sortParam === "comments") {
    sortBy = HN_SORT_OPTIONS.COMMENTS;
  }

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<HNFilterId>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const debouncedSearch = useDebounce(search, 300);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleRefresh = useCallback(async () => {
    try {
      setIsRefreshing(true);
      await kyInstance.post("/api/hackernews").json<{ success: boolean }>();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["hackernews"] }),
        queryClient.invalidateQueries({ queryKey: ["hn-top-stories"] }),
        queryClient.invalidateQueries({ queryKey: ["hn-sidebar-stories"] }),
      ]);
      toast({
        description: "Fresh stories, ready when you are!",
        title: "Refreshed",
      });
    } catch {
      toast({
        description: "Couldn't refresh stories, try again?",
        title: "Couldn't Refresh",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, toast]);

  const refreshButton = (
    <button
      aria-label="Refresh stories"
      className="btn-3d flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-all active:translate-y-px"
      disabled={isRefreshing}
      onClick={handleRefresh}
      type="button"
    >
      <RefreshCw
        className={cn("inline-block h-4 w-4", isRefreshing && "animate-spin")}
        strokeWidth={2.5}
      />
    </button>
  );

  const handleSortChange = useCallback(
    (value: string) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (value === "time" || value === "comments") {
        nextParams.set("sort", value);
      } else {
        nextParams.delete("sort");
      }
      const query = nextParams.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams]
  );

  if (!userData) {
    return null;
  }

  return (
    <div className="relative flex h-dvh overflow-hidden">
      <LeftSidebar userData={userData} />

      <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
        <Tabs
          className="flex min-h-0 flex-1 flex-col"
          onValueChange={handleSortChange}
          value={sortBy}
        >
          <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
            <MobileTopBar />
            <div className="border-border/60 relative flex items-center border-b py-1.5">
              <TabsList className="flex h-full flex-1 items-center justify-center gap-0 bg-transparent p-0 md:justify-start">
                <TabsTrigger className={TAB_TRIGGER_CLASS} value="score">
                  Score
                </TabsTrigger>
                <TabsTrigger className={TAB_TRIGGER_CLASS} value="time">
                  Time
                </TabsTrigger>
                <TabsTrigger className={TAB_TRIGGER_CLASS} value="comments">
                  Comments
                </TabsTrigger>
              </TabsList>
              <div className="ml-auto hidden min-w-0 items-center gap-2 pr-1.5 md:flex">
                <HNSearchBar
                  filter={filter}
                  onFilterChange={setFilter}
                  onSearchChange={setSearch}
                  search={search}
                />
                {refreshButton}
              </div>
            </div>
            <div className="border-border/60 flex items-center gap-2 border-b px-3 py-2 md:hidden">
              <HNSearchBar
                filter={filter}
                onFilterChange={setFilter}
                onSearchChange={setSearch}
                search={search}
              />
              {refreshButton}
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            <div
              className="hide-native-scrollbar h-full overflow-x-hidden overflow-y-auto"
              ref={feedScrollRef}
            >
              <HNFeed
                filter={filter}
                search={debouncedSearch}
                sortBy={sortBy}
              />
            </div>
            <FeedScrollbar containerRef={feedScrollRef} />
          </div>
        </Tabs>
      </div>

      <HnRightSideBar />
      <MobileBottomNav />
    </div>
  );
};

export default ClientHackerNews;
