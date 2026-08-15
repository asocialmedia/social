"use client";

import type { PostsPage, UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import noMediaImage from "@assets/general/nomedia.png";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Loader2,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSession } from "@/app/(main)/session-provider";
import { GustCard } from "@/components/gusts/gust-card";
import { GustCardSkeleton } from "@/components/gusts/gust-card-skeleton";
import { GustsCommentsDrawer } from "@/components/gusts/gusts-comments-drawer";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import { useSpotlight } from "@/components/search/spotlight-provider";
import { useRequireAuth } from "@/hooks/use-require-auth";
import kyInstance from "@/lib/ky";
import { useComposerStore } from "@/store/composer-store";

interface ClientGustsProps {
  loggedInUserData: UserData | null;
}

export const ClientGusts: React.FC<ClientGustsProps> = ({
  loggedInUserData,
}) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialPostId = searchParams.get("id");
  const autoOpenCreate = searchParams.get("create") === "true";

  const { user } = useSession();
  const { openSpotlight } = useSpotlight();
  const { goToLogin } = useRequireAuth();
  const openComposer = useComposerStore((state) => state.openComposer);

  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);

  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [newGustCount, setNewGustCount] = useState(0);
  const touchStartYRef = useRef<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Infinite query for gusts
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
    status,
  } = useInfiniteQuery({
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      kyInstance
        .get(
          "/api/gusts",
          pageParam ? { searchParams: { cursor: pageParam } } : {}
        )
        .json<PostsPage>(),
    queryKey: ["gusts-feed"],
    staleTime: 1000 * 60,
  });

  const posts = useMemo(
    () =>
      (data?.pages.flatMap((page) => page.posts) || []).filter((post) =>
        post.attachments.some((m) => m.type === "VIDEO")
      ),
    [data?.pages]
  );

  // Refetch the feed and surface a pill when brand-new gusts (not already in
  // the current list) appeared at the top since the last load.
  const refreshFeed = useCallback(async () => {
    if (isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    const knownIds = new Set(posts.map((post) => post.id));
    try {
      const result = await refetch();
      const fresh = result.data?.pages.flatMap((page) => page.posts) ?? [];
      let count = 0;
      for (const post of fresh) {
        if (
          post.attachments.some((m) => m.type === "VIDEO") &&
          !knownIds.has(post.id)
        ) {
          count += 1;
        } else {
          break;
        }
      }
      setNewGustCount((previous) => Math.max(previous, count));
    } finally {
      setIsRefreshing(false);
      setPullDistance(0);
    }
  }, [isRefreshing, posts, refetch]);

  // Jump to the very first gust and clear the new-gust pill.
  const showNewGusts = useCallback(() => {
    containerRef.current?.scrollTo({ behavior: "smooth", top: 0 });
    setNewGustCount(0);
  }, []);

  // Pull-to-refresh: track a downward drag from the top of the stream and
  // trigger a refetch once the gesture crosses the threshold.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleTouchStart = (event: TouchEvent) => {
      touchStartYRef.current =
        container.scrollTop <= 0 ? (event.touches[0]?.clientY ?? null) : null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const startY = touchStartYRef.current;
      if (startY === null || isRefreshing) {
        return;
      }
      const delta = (event.touches[0]?.clientY ?? startY) - startY;
      if (delta > 0 && container.scrollTop <= 0) {
        // Pull the indicator down with a little resistance.
        setPullDistance(Math.min(delta * 0.45, 96));
      }
    };

    const handleTouchEnd = () => {
      touchStartYRef.current = null;
      if (pullDistance >= 56) {
        void refreshFeed();
      } else {
        setPullDistance(0);
      }
    };

    container.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isRefreshing, pullDistance, refreshFeed]);

  // If initialPostId was provided, scroll to it once posts are loaded
  useEffect(() => {
    if (initialPostId && posts.length > 0) {
      const idx = posts.findIndex((p) => p.id === initialPostId);
      if (idx !== -1) {
        itemRefs.current[idx]?.scrollIntoView({ behavior: "smooth" });
      }
    }
  }, [initialPostId, posts]);

  // Set up IntersectionObserver to detect currently centered Reel
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (!Number.isNaN(index)) {
              setActiveIndex(index);
              // Prefetch next page when nearing end
              if (index >= posts.length - 2 && hasNextPage) {
                fetchNextPage();
              }
            }
          }
        }
      },
      {
        root: containerRef.current,
        threshold: 0.6,
      }
    );

    const elements = itemRefs.current;
    for (const el of elements) {
      if (el) {
        observer.observe(el);
      }
    }

    return () => {
      observer.disconnect();
    };
  }, [fetchNextPage, hasNextPage, posts.length]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const nextIdx = Math.min(activeIndex + 1, posts.length - 1);
        itemRefs.current[nextIdx]?.scrollIntoView({ behavior: "smooth" });
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const prevIdx = Math.max(activeIndex - 1, 0);
        itemRefs.current[prevIdx]?.scrollIntoView({ behavior: "smooth" });
      } else if (e.key === "m") {
        e.preventDefault();
        setIsMuted((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, posts.length]);

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  // Record a visit for the active gust so the recents card surfaces it and
  // keeps the "recently viewed" order fresh. Guests don't have history.
  const queryClient = useQueryClient();
  const isLoggedIn = Boolean(user);
  const activePost = posts[activeIndex];
  useEffect(() => {
    if (!isLoggedIn || !activePost) {
      return;
    }
    const recordVisit = async () => {
      try {
        await kyInstance.post("/api/posts/visit", {
          json: { postId: activePost.id },
        });
        await queryClient.invalidateQueries({ queryKey: ["post-history"] });
      } catch {
        // Best-effort visit tracking; ignore failures
      }
    };
    void recordVisit();
  }, [activePost, isLoggedIn, queryClient]);

  const handleOpenUpload = useCallback(() => {
    if (!user) {
      goToLogin();
      return;
    }
    openComposer("gust");
  }, [goToLogin, openComposer, user]);

  // ?create=true opens the composer in gust mode on arrival.
  useEffect(() => {
    if (autoOpenCreate && user) {
      openComposer("gust");
    }
  }, [autoOpenCreate, openComposer, user]);

  const scrollToPrev = useCallback(() => {
    const prevIdx = Math.max(activeIndex - 1, 0);
    itemRefs.current[prevIdx]?.scrollIntoView({ behavior: "smooth" });
  }, [activeIndex]);

  const scrollToNext = useCallback(() => {
    const nextIdx = Math.min(activeIndex + 1, posts.length - 1);
    itemRefs.current[nextIdx]?.scrollIntoView({ behavior: "smooth" });
  }, [activeIndex, posts.length]);

  const renderContent = () => {
    if (status === "pending") {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <GustCardSkeleton />
        </div>
      );
    }

    if (posts.length === 0) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center">
          <Image
            alt="No Gusts"
            className="mb-4 size-32 rounded-full object-contain opacity-80"
            draggable={false}
            height={128}
            src={noMediaImage}
            width={128}
          />
          <h2 className="text-foreground text-xl font-bold">No Gusts yet</h2>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            Be the first to share a high-energy short-form video clip with the
            community!
          </p>
          <Button className="mt-5" onClick={handleOpenUpload} variant="premium">
            <Plus className="mr-1.5 size-4" />
            Create the First Gust
          </Button>
        </div>
      );
    }

    return (
      <div className="flex h-full w-full max-w-6xl items-center justify-center gap-4 py-0 sm:px-2 sm:py-3 md:px-6">
        {/* Vertical Snap Stream */}
        <div
          className="hide-native-scrollbar h-full w-full max-w-4xl snap-y snap-mandatory overflow-y-auto overscroll-y-contain"
          ref={containerRef}
        >
          {posts.map((post, idx) => (
            <div
              className="flex h-full w-full snap-start snap-always items-center justify-center py-0 sm:h-[98%] sm:py-2"
              data-index={idx}
              key={post.id}
              ref={(el) => {
                itemRefs.current[idx] = el;
              }}
            >
              <GustCard
                isActive={activeIndex === idx}
                isMuted={isMuted}
                onOpenComments={() => setIsCommentsOpen(true)}
                onToggleMute={handleToggleMute}
                post={post}
              />
            </div>
          ))}

          {isFetchingNextPage ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="text-primary size-6 animate-spin" />
            </div>
          ) : null}
        </div>

        {isCommentsOpen && posts[activeIndex] ? (
          <div className="hidden h-full max-h-[calc(100dvh-5rem)] w-[420px] shrink-0 md:block">
            <div className="reels-panel flex h-full w-full flex-col overflow-hidden rounded-3xl">
              <GustsCommentsDrawer
                onClose={() => setIsCommentsOpen(false)}
                post={posts[activeIndex]}
              />
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="bg-background relative flex h-dvh overflow-hidden">
      {/* Left Navigation Sidebar */}
      <LeftSidebar userData={loggedInUserData} />

      {/* Main Gusts Container */}
      <div className="relative flex min-w-0 flex-1 justify-center overflow-hidden">
        {/* Floating back button (mobile) */}
        <button
          aria-label="Go back"
          className="rail-3d-btn absolute top-4 left-4 z-30 flex h-10 w-10 items-center justify-center rounded-full md:hidden"
          onClick={() => router.back()}
          type="button"
        >
          <ChevronLeft className="size-5" />
        </button>

        {/* Floating search button (mobile) */}
        <button
          aria-label="Search"
          className="rail-3d-btn absolute top-4 right-4 z-30 flex h-10 w-10 items-center justify-center rounded-full md:hidden"
          onClick={() => openSpotlight()}
          type="button"
        >
          <Search className="size-5" />
        </button>

        {renderContent()}

        {/* Pull-to-refresh indicator (mobile) */}
        <motion.div
          animate={{
            height: pullDistance > 0 || isRefreshing ? pullDistance : 0,
            opacity: pullDistance > 0 || isRefreshing ? 1 : 0,
          }}
          className="absolute top-2 right-0 left-0 z-20 flex items-start justify-center overflow-hidden"
          style={{ height: pullDistance || 0 }}
        >
          <div className="rail-3d-btn mt-1 flex h-10 w-10 items-center justify-center rounded-full">
            {isRefreshing ? (
              <Loader2 className="text-primary size-5 animate-spin" />
            ) : (
              <Loader2
                className="text-primary size-5"
                style={{ transform: `rotate(${pullDistance * 2}deg)` }}
              />
            )}
          </div>
        </motion.div>

        {/* New gust pill */}
        <AnimatePresence>
          {newGustCount > 0 ? (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="absolute top-4 left-1/2 z-30 -translate-x-1/2"
              exit={{ opacity: 0, y: -12 }}
              initial={{ opacity: 0, y: -12 }}
            >
              <button
                className="rail-3d-btn flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium"
                onClick={showNewGusts}
                type="button"
              >
                <Sparkles className="size-4" />
                {newGustCount} new gust{newGustCount === 1 ? "" : "s"}
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Scroll Up / Down Navigation pinned to the rightmost edge (desktop) */}
        {status === "success" && posts.length > 0 ? (
          <div className="fixed top-1/2 right-3 z-30 hidden -translate-y-1/2 flex-col items-center gap-3 lg:flex">
            <button
              aria-label="Previous Gust"
              className="rail-3d-btn flex h-11 w-11 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
              disabled={activeIndex === 0}
              onClick={scrollToPrev}
              type="button"
            >
              <ChevronUp className="size-5" />
            </button>
            <button
              aria-label="Next Gust"
              className="rail-3d-btn flex h-11 w-11 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
              disabled={activeIndex >= posts.length - 1}
              onClick={scrollToNext}
              type="button"
            >
              <ChevronDown className="size-5" />
            </button>
          </div>
        ) : null}

        {/* Mobile slide-up comments drawer */}
        <AnimatePresence>
          {isCommentsOpen && posts[activeIndex] ? (
            <>
              <motion.div
                animate={{ opacity: 1 }}
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs md:hidden"
                exit={{ opacity: 0 }}
                initial={{ opacity: 0 }}
                onClick={() => setIsCommentsOpen(false)}
              />
              <motion.div
                animate={{ y: 0 }}
                className="reels-panel fixed inset-x-0 bottom-0 z-50 flex h-[75vh] flex-col overflow-hidden rounded-t-3xl md:hidden"
                exit={{ y: "100%" }}
                initial={{ y: "100%" }}
                transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              >
                <GustsCommentsDrawer
                  onClose={() => setIsCommentsOpen(false)}
                  post={posts[activeIndex]}
                />
              </motion.div>
            </>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
};
