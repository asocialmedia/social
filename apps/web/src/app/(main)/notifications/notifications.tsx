"use client";

import { clientLog } from "@asm/config/debug";
import type { NotificationsPage } from "@asm/db";
import { Separator } from "@asm/ui/shadui/separator";
import noBookmarksImage from "@assets/general/nonotibook.png";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import Image from "next/image";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { TAB_TRIGGER_CLASS } from "@/components/home/feedview/tab-trigger-class";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import NotificationsSkeleton from "@/components/layouts/skeletons/notifications-skeleton";
import kyInstance from "@/lib/ky";

import Notification from "./notification";

type NotificationTab = "all" | "mentions";

export default function Notifications() {
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<NotificationTab>("all");

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      kyInstance
        .get(
          "/api/notifications",
          pageParam
            ? { searchParams: { cursor: pageParam, type: activeTab } }
            : { searchParams: { type: activeTab } }
        )
        .json<NotificationsPage>(),
    queryKey: ["notifications", activeTab],
  });

  const queryClient = useQueryClient();

  const { mutate } = useMutation({
    mutationFn: () => kyInstance.patch("/api/notifications/mark-as-read"),
    onError(error) {
      clientLog.error("Failed to mark notifications as read", error);
    },
    onSuccess: () => {
      queryClient.setQueryData(["unread-notification-count"], {
        unreadCount: 0,
      });
    },
  });

  useEffect(() => {
    mutate();
  }, [mutate]);

  const notifications = data?.pages.flatMap((page) => page.notifications) || [];

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  const handleShowAll = useCallback(() => setActiveTab("all"), []);
  const handleShowMentions = useCallback(() => setActiveTab("mentions"), []);

  let feedBody: React.ReactNode;
  if (status === "pending") {
    feedBody = <NotificationsSkeleton />;
  } else if (status === "error") {
    feedBody = (
      <p className="text-destructive px-4 py-8 text-center">
        An error occurred while loading rustles.
      </p>
    );
  } else if (notifications.length || hasNextPage) {
    feedBody = (
      <InfiniteScrollContainer onBottomReached={handleBottomReached}>
        <div className="flex flex-col">
          {notifications.map((notification, index) => (
            <div key={notification.id}>
              {index > 0 && <Separator className="bg-border/60" />}
              <Notification notification={notification} />
            </div>
          ))}
        </div>
        {isFetchingNextPage ? <NotificationsSkeleton /> : null}
      </InfiniteScrollContainer>
    );
  } else {
    feedBody = (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <Image
          alt=""
          className="h-40 w-auto object-contain"
          draggable={false}
          height={1024}
          src={noBookmarksImage}
          width={1536}
        />
        <p className="font-medium">
          {activeTab === "mentions" ? "No mentions yet" : "No rustles yet"}
        </p>
        <p className="text-muted-foreground text-sm">
          {activeTab === "mentions"
            ? "Mentions of you in posts will show up here."
            : "Follows, amplifies, eddies and mentions will show up here."}
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
        <MobileTopBar />
        <div className="border-border/60 flex items-center border-b">
          <button
            className={`${TAB_TRIGGER_CLASS} flex-1 ${
              activeTab === "all" ? "data-[state=active]" : ""
            }`}
            data-state={activeTab === "all" ? "active" : "inactive"}
            onClick={handleShowAll}
            type="button"
          >
            All
          </button>
          <button
            className={`${TAB_TRIGGER_CLASS} flex-1 ${
              activeTab === "mentions" ? "data-[state=active]" : ""
            }`}
            data-state={activeTab === "mentions" ? "active" : "inactive"}
            onClick={handleShowMentions}
            type="button"
          >
            Mentions
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          className="hide-native-scrollbar h-full overflow-x-hidden overflow-y-auto"
          ref={feedScrollRef}
        >
          {feedBody}
        </div>
        <FeedScrollbar containerRef={feedScrollRef} />
      </div>
    </div>
  );
}
