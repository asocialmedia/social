"use client";

import { Input } from "@asm/ui/shadui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@asm/ui/shadui/select";
import { Separator } from "@asm/ui/shadui/separator";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Compass, Search, Users } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import useDebounce from "@/hooks/use-debounce";
import kyInstance from "@/lib/ky";
import ExploreUserRow, { type ExploreUser } from "./explore-user-row";
import ExploreUsersSkeleton from "./explore-user-row-skeleton";

type ExploreTab = "suggested" | "trending" | "new" | "browse";

const TAB_META: Record<ExploreTab, string> = {
  suggested: "For you",
  trending: "Trending",
  new: "New",
  browse: "Browse",
};

const ExploreClient: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const tabParam = searchParams.get("tab");
  let activeTab: ExploreTab = "suggested";
  if (tabParam === "trending" || tabParam === "new" || tabParam === "browse") {
    activeTab = tabParam;
  }

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("followers");
  const debouncedSearch = useDebounce(search, 300);

  const handleTabChange = useCallback(
    (tab: string) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (tab === "suggested") {
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
    () => ["explore-users", activeTab, debouncedSearch, sortBy],
    [activeTab, debouncedSearch, sortBy]
  );

  const { data, status } = useQuery({
    queryKey,
    queryFn: () => {
      if (activeTab === "browse") {
        return kyInstance
          .get("/api/users/browse", {
            searchParams: { search: debouncedSearch, sortBy },
          })
          .json<ExploreUser[]>();
      }
      return kyInstance
        .get(`/api/users/${activeTab === "new" ? "new" : activeTab}`)
        .json<ExploreUser[]>();
    },
    staleTime: 60 * 1000,
  });

  const users = data ?? [];

  const handleFollowed = useCallback(
    (userId: string) => {
      queryClient.setQueryData<ExploreUser[]>(queryKey, (old) =>
        old ? old.filter((user) => user.id !== userId) : old
      );
    },
    [queryClient, queryKey]
  );

  const handleTabClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const { tab } = e.currentTarget.dataset;
      if (tab) {
        handleTabChange(tab);
      }
    },
    [handleTabChange]
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  let body: React.ReactNode;
  if (status === "pending") {
    body = <ExploreUsersSkeleton />;
  } else if (status === "error") {
    body = (
      <p className="px-4 py-8 text-center text-destructive">
        An error occurred while loading users.
      </p>
    );
  } else if (users.length === 0) {
    body = (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
        <Users className="h-6 w-6 text-muted-foreground/60" />
        <p className="font-medium">
          {activeTab === "browse" ? "No users found" : "Nothing here yet"}
        </p>
        <p className="text-muted-foreground text-sm">
          {activeTab === "browse"
            ? "Try a different search or sort."
            : "Users will show up here."}
        </p>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col">
        {users.map((user, index) => (
          <div key={user.id}>
            {index > 0 && <Separator className="bg-border/60" />}
            <ExploreUserRow onFollowed={handleFollowed} user={user} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
        <MobileTopBar />
        <div className="flex items-center gap-2 border-border/60 border-b px-4 py-3">
          <Compass className="h-5 w-5 text-muted-foreground" />
          <h1 className="font-semibold text-lg">Explore</h1>
        </div>
        <div className="flex items-center border-border/60 border-b">
          {(Object.keys(TAB_META) as ExploreTab[]).map((tab) => (
            <button
              className={`${TAB_TRIGGER_CLASS} flex-1`}
              data-state={activeTab === tab ? "active" : "inactive"}
              data-tab={tab}
              key={tab}
              onClick={handleTabClick}
              type="button"
            >
              {TAB_META[tab]}
            </button>
          ))}
        </div>

        {activeTab === "browse" ? (
          <div className="flex items-center gap-2 border-border/60 border-b px-3 py-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search users"
                autoComplete="off"
                className="premium-input h-9 rounded-xl pr-3 pl-9 text-sm"
                onChange={handleSearchChange}
                placeholder="Search users..."
                type="text"
                value={search}
              />
            </div>
            <Select onValueChange={setSortBy} value={sortBy}>
              <SelectTrigger className="w-[150px] rounded-xl border border-border/60 bg-background/60 text-sm">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="followers">Most followers</SelectItem>
                <SelectItem value="posts">Most posts</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="oldest">Oldest</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          className="hide-native-scrollbar h-full overflow-y-auto overflow-x-hidden"
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
