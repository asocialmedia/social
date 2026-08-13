"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useMemo, useRef } from "react";
import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import kyInstance from "@/lib/ky";
import ExploreUserCard, { type ExploreUser } from "./explore-user-card";
import ExploreUsersSkeleton from "./explore-users-skeleton";

type ExploreTab = "suggested" | "trending" | "new";

const TAB_META: Record<ExploreTab, string> = {
  suggested: "For you",
  trending: "Trending",
  new: "New",
};

const ExploreClient: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const tabParam = searchParams.get("tab");
  let activeTab: ExploreTab = "suggested";
  if (tabParam === "trending" || tabParam === "new") {
    activeTab = tabParam;
  }

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

  const queryKey = useMemo(() => ["explore-users", activeTab], [activeTab]);

  const { data, status } = useQuery({
    queryKey,
    queryFn: () =>
      kyInstance
        .get(`/api/users/${activeTab === "new" ? "new" : activeTab}`)
        .json<ExploreUser[]>(),
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
        <p className="font-medium">Nothing here yet</p>
        <p className="text-muted-foreground text-sm">
          Users will show up here.
        </p>
      </div>
    );
  } else {
    body = (
      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {users.map((user) => (
          <ExploreUserCard
            key={user.id}
            onFollowed={handleFollowed}
            user={user}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
        <MobileTopBar />
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
