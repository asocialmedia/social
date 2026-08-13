"use client";

import { clientLog } from "@asm/config/debug";

import type { NotificationsPage } from "@asm/db";
import { Separator } from "@asm/ui/shadui/separator";
import nomessageImage from "@assets/general/nomessage.png";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Image from "next/image";
import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import kyInstance from "@/lib/ky";
import Notification from "./notification";

export default function Notifications() {
  const feedScrollRef = useRef<HTMLDivElement>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ["notifications"],
    queryFn: ({ pageParam }) =>
      kyInstance
        .get(
          "/api/notifications",
          pageParam ? { searchParams: { cursor: pageParam } } : {}
        )
        .json<NotificationsPage>(),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const queryClient = useQueryClient();

  const { mutate } = useMutation({
    mutationFn: () => kyInstance.patch("/api/notifications/mark-as-read"),
    onSuccess: () => {
      queryClient.setQueryData(["unread-notification-count"], {
        unreadCount: 0,
      });
    },
    onError(error) {
      clientLog.error("Failed to mark notifications as read", error);
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

  let feedBody: React.ReactNode;
  if (status === "pending") {
    feedBody = <FeedViewSkeleton />;
  } else if (status === "error") {
    feedBody = (
      <p className="px-4 py-8 text-center text-destructive">
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
        {isFetchingNextPage ? <FeedViewSkeleton /> : null}
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
          src={nomessageImage}
          width={1536}
        />
        <p className="font-medium">No rustles yet</p>
        <p className="text-muted-foreground text-sm">
          Follows, amplifies, eddies and mentions will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
        <MobileTopBar />
        <div className="flex items-center gap-2 border-border/60 border-b px-4 py-3">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <h1 className="font-semibold text-lg">Rustles</h1>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          className="hide-native-scrollbar h-full overflow-y-auto overflow-x-hidden"
          ref={feedScrollRef}
        >
          {feedBody}
        </div>
        <FeedScrollbar containerRef={feedScrollRef} />
      </div>
    </div>
  );
}
