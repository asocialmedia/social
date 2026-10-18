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
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AnimatedTabButton } from "@/components/home/feedview/animated-tab-trigger";
import { FeedScrollbar } from "@/components/layouts/feed/feed-scrollbar";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import MobileTopBar from "@/components/layouts/navigation/mobile/mobile-top-bar";
import NotificationsSkeleton from "@/components/layouts/skeletons/notifications-skeleton";
import { useFeedSwipeNavigation } from "@/hooks/feed/use-feed-swipe-navigation";
import { useGoBack } from "@/hooks/use-go-back";
import kyInstance from "@/lib/ky";
import { groupNotifications } from "@/lib/notifications/grouping";

import Notification from "./notification";

type NotificationTab = "all" | "mentions";

// Swipe order mirrors the rendered tab strip order.
const TAB_ORDER: NotificationTab[] = ["all", "mentions"];

export default function Notifications() {
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const goBack = useGoBack();
  const [activeTab, setActiveTab] = useState<NotificationTab>("all");
  const [slideDirection, setSlideDirection] = useState<-1 | 1 | 0>(0);

  const handleTabChange = useCallback(
    (tab: NotificationTab) => {
      if (tab === activeTab) {
        return;
      }
      const currentIndex = TAB_ORDER.indexOf(activeTab);
      const nextIndex = TAB_ORDER.indexOf(tab);
      setSlideDirection(nextIndex > currentIndex ? 1 : -1);
      setActiveTab(tab);
    },
    [activeTab]
  );

  // Swiping / sliding content navigates between tabs.
  const handleSwipeNavigate = useCallback(
    (direction: -1 | 1) => {
      const nextIndex = TAB_ORDER.indexOf(activeTab) + direction;
      if (nextIndex >= 0 && nextIndex < TAB_ORDER.length) {
        setSlideDirection(direction);
        setActiveTab(TAB_ORDER[nextIndex]);
      }
    },
    [activeTab]
  );
  useFeedSwipeNavigation(feedScrollRef, handleSwipeNavigate, {
    enableDesktop: true,
  });

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

  const notifications = useMemo(
    () =>
      groupNotifications(
        data?.pages.flatMap((page) => page.notifications) || []
      ),
    [data]
  );

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  const handleShowAll = useCallback(
    () => handleTabChange("all"),
    [handleTabChange]
  );
  const handleShowMentions = useCallback(
    () => handleTabChange("mentions"),
    [handleTabChange]
  );

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
        <MobileTopBar onBack={goBack} />
        <div className="border-border/60 flex items-center justify-center border-b">
          <AnimatedTabButton
            active={activeTab === "all"}
            className="px-6 py-3 text-base data-[state=active]:px-6"
            layoutId="notifications-tab-indicator"
            onClick={handleShowAll}
          >
            All
          </AnimatedTabButton>
          <AnimatedTabButton
            active={activeTab === "mentions"}
            className="px-6 py-3 text-base data-[state=active]:px-6"
            layoutId="notifications-tab-indicator"
            onClick={handleShowMentions}
          >
            Mentions
          </AnimatedTabButton>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          className="hide-native-scrollbar h-full touch-pan-y overflow-x-hidden overflow-y-auto"
          ref={feedScrollRef}
        >
          <AnimatePresence custom={slideDirection} initial={false} mode="wait">
            <motion.div
              animate="center"
              custom={slideDirection}
              exit="exit"
              initial="enter"
              key={activeTab}
              transition={{ duration: 0.18, ease: "easeOut" }}
              variants={{
                center: {
                  opacity: 1,
                  x: 0,
                },
                enter: (dir: number) => {
                  let x = 0;
                  if (dir > 0) {
                    x = 30;
                  } else if (dir < 0) {
                    x = -30;
                  }
                  return { opacity: 0, x };
                },
                exit: (dir: number) => {
                  let x = 0;
                  if (dir > 0) {
                    x = -30;
                  } else if (dir < 0) {
                    x = 30;
                  }
                  return { opacity: 0, x };
                },
              }}
            >
              {feedBody}
            </motion.div>
          </AnimatePresence>
        </div>
        <FeedScrollbar containerRef={feedScrollRef} />
      </div>
    </div>
  );
}
