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
import { useInView } from "react-intersection-observer";

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

  // Restore the saved video mute preference after hydration so a gust the user
  // muted stays muted (or unmuted) across page loads. The lazy default stays
  // true to avoid an SSR/hydration mismatch; this effect reconciles it once.
  useEffect(() => {
    const stored = localStorage.getItem("gust-video-muted");
    if (stored !== null) {
      // Deferred so the preference applies right after the first paint.
      queueMicrotask(() => setIsMuted(stored === "true"));
    }
  }, []);

  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [newGustCount, setNewGustCount] = useState(0);
  const touchStartYRef = useRef<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  // The app-wide infinite-scroll pattern (same hook the feeds use): a bottom
  // sentinel flips inView when it enters the viewport, which paginates even
  // when the list is too short to scroll.
  const { inView: isEndVisible, ref: endSentinelRef } = useInView({
    rootMargin: "200px",
  });

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

  // When the feed is exhausted, render a second pixel-identical copy of the
  // stream right after the first. The scroll listener below snaps scrollTop
  // back from the duplicate to the same spot in the first copy, so scrolling
  // past the last gust flows straight into the first again - no reverse-scroll
  // animation, no bottom wall, the wrap is invisible because both copies look
  // exactly the same.
  const displayPosts = useMemo(() => {
    if (hasNextPage || posts.length === 0) {
      return posts;
    }
    return [...posts, ...posts];
  }, [hasNextPage, posts]);

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

  // Kept in sync so the wheel/touch listeners (attached once) can consult the
  // current value without re-binding on every fetch state change.
  const hasNextPageRef = useRef(hasNextPage);
  useEffect(() => {
    hasNextPageRef.current = hasNextPage;
  }, [hasNextPage]);

  // Locks input while a wrap-around jump is in flight so momentum can't fight
  // the animation, and temporarily lifts CSS scroll-snap so the browser can't
  // snap back to the old position (which made loops look like they "bounced"
  // in place instead of landing at the top/bottom).
  const isWrappingRef = useRef(false);
  const wrapTo = useCallback((target: number, smooth = true) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    isWrappingRef.current = true;
    container.style.scrollSnapType = "none";
    container.scrollTo({ behavior: smooth ? "smooth" : "auto", top: target });
    window.setTimeout(
      () => {
        container.style.scrollSnapType = "";
        isWrappingRef.current = false;
      },
      smooth ? 900 : 80
    );
  }, []);

  // Scrolls the stream so the gust at `idx` is in view, computing the target
  // directly on the scroll container. scrollIntoView would also scroll every
  // scrollable ancestor (fighting the snap container and the page layout),
  // which is what made the buttons/keyboard jump to a wrong-looking spot.
  const scrollToItem = useCallback(
    (idx: number) => {
      const container = containerRef.current;
      const el = itemRefs.current[idx];
      if (!container || !el) {
        return;
      }
      const target = Math.min(
        Math.max(el.offsetTop - container.offsetTop, 0),
        container.scrollHeight - container.clientHeight
      );
      wrapTo(target);
    },
    [wrapTo]
  );

  // Touch handling: pull-to-refresh from the top. Swiping past the last gust
  // needs no handling here - the doubled stream's scroll listener wraps it
  // back to the first copy seamlessly.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null;
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
    // posts.length gates this: the scroll container only exists once content
    // renders, and the effect must (re)attach after it mounts.
  }, [isRefreshing, posts.length, pullDistance, refreshFeed]);

  // Scrolling down needs no boundary handling: the doubled stream lets the
  // browser scroll straight past the last gust into the duplicate, and the
  // listener below invisibly wraps scrollTop back to the identical spot in the
  // first copy. Only scrolling up past the very first gust needs a nudge to
  // land on the last one.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      // Let a nav animation settle before handling more input.
      if (isWrappingRef.current) {
        return;
      }
      // While more pages exist the bottom sentinel keeps loading; the loop
      // only kicks in once the feed is exhausted (and the stream is doubled).
      if (hasNextPageRef.current) {
        return;
      }
      if (event.deltaY < 0 && container.scrollTop <= 2) {
        event.preventDefault();
        scrollToItem(posts.length - 1);
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
    // posts.length gates this: the scroll container only exists once content
    // renders, so the listener attaches on first content and re-attaches as
    // the feed grows.
  }, [posts.length, scrollToItem]);

  // The invisible loop: with the stream doubled, this listener keeps scrollTop
  // inside the first copy. The moment scrolling enters the duplicate it snaps
  // back by exactly one copy height - both copies render identical content, so
  // the jump is imperceptible and 1 -> 2 -> 3 -> 1 -> 2 -> 3 feels continuous.
  useEffect(() => {
    if (hasNextPage || posts.length === 0) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      const copyHeight = container.scrollHeight / 2;
      if (container.scrollTop >= copyHeight) {
        container.scrollTop -= copyHeight;
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [hasNextPage, posts.length]);

  // If ?id= was provided, jump straight to that gust once the feed is loaded:
  // mark it active (so its video plays) and center it in the stream container
  // instantly. scrollIntoView would smooth-scroll every scrollable ancestor,
  // dragging the whole page through the list; scrolling the container directly
  // lands on the gust immediately. A ref keeps this a one-time jump instead of
  // re-scrolling every time the feed grows or refetches.
  const didJumpToInitialRef = useRef(false);
  useEffect(() => {
    if (!initialPostId || posts.length === 0 || didJumpToInitialRef.current) {
      return;
    }
    const idx = posts.findIndex((post) => post.id === initialPostId);
    if (idx === -1) {
      return;
    }
    didJumpToInitialRef.current = true;
    // The IntersectionObserver picks up the now-centered item and marks it
    // active, so no manual setState is needed here.
    const container = containerRef.current;
    const el = itemRefs.current[idx];
    if (container && el) {
      const containerTop = container.getBoundingClientRect().top;
      const elTop = el.getBoundingClientRect().top;
      const target =
        container.scrollTop +
        (elTop - containerTop) -
        (container.clientHeight - el.clientHeight) / 2;
      container.scrollTo({ top: Math.max(0, target) });
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
  }, [posts.length]);

  // A bottom sentinel drives pagination instead of watching the last card, so
  // the feed keeps loading even when a page holds very few gusts - the
  // sentinel is already visible at the bottom of short content, so the next
  // page is fetched immediately (and every page after that until the API runs
  // out).
  useEffect(() => {
    if (isEndVisible && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isEndVisible, isFetchingNextPage]);

  // When the visible list is empty (e.g. the first page held no video gusts)
  // but more pages exist, keep loading until something appears or the feed is
  // exhausted instead of showing the empty state prematurely.
  useEffect(() => {
    if (posts.length === 0 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, posts.length]);

  // Keyboard navigation
  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      localStorage.setItem("gust-video-muted", String(next));
      return next;
    });
  }, []);

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
        // Wrap around: next past the last gust loops back to the first.
        const nextIdx = activeIndex >= posts.length - 1 ? 0 : activeIndex + 1;
        scrollToItem(nextIdx);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        // Wrap around: previous before the first gust loops to the last.
        const prevIdx = activeIndex <= 0 ? posts.length - 1 : activeIndex - 1;
        scrollToItem(prevIdx);
      } else if (e.key === "m") {
        e.preventDefault();
        handleToggleMute();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, posts.length, handleToggleMute, scrollToItem]);

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
    // Wrap around: previous before the first gust loops to the last.
    const prevIdx = activeIndex <= 0 ? posts.length - 1 : activeIndex - 1;
    scrollToItem(prevIdx);
  }, [activeIndex, posts.length, scrollToItem]);

  const scrollToNext = useCallback(() => {
    // Wrap around: next past the last gust loops back to the first.
    const nextIdx = activeIndex >= posts.length - 1 ? 0 : activeIndex + 1;
    scrollToItem(nextIdx);
  }, [activeIndex, posts.length, scrollToItem]);

  const renderContent = () => {
    if (status === "pending") {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <GustCardSkeleton />
        </div>
      );
    }

    // An empty-but-loading feed: the auto-fetch keeps pulling pages while more
    // exist (and the first page may simply not have had video gusts). Show the
    // skeleton instead of the "No Gusts yet" panel so the empty state only
    // appears once the feed is genuinely exhausted.
    if (posts.length === 0 && hasNextPage) {
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
          {displayPosts.map((post, idx) => {
            // Second copy renders the same gust again - only the first copy
            // drives the navigation refs and the active-gust observer.
            const inDuplicate = idx >= posts.length;
            const itemIndex = idx % posts.length;
            const isCurrentActive = activeIndex === itemIndex;
            // Only mount <video src> for the active clip and its immediate next/prev
            // neighbours. Offscreen clips remain lightweight poster placeholders so
            // the browser does not flood the network with 20 parallel Range reads.
            const rawDist = Math.abs(itemIndex - activeIndex);
            const wrapDist =
              posts.length > 0 ? posts.length - rawDist : rawDist;
            const distance = Math.min(rawDist, wrapDist);
            const shouldMount = isCurrentActive || distance <= 1;

            return (
              <div
                className="flex h-full w-full snap-start snap-always items-center justify-center py-0 sm:h-[98%] sm:py-2"
                data-index={itemIndex}
                key={inDuplicate ? `${post.id}-copy2` : post.id}
                ref={(el) => {
                  if (!inDuplicate) {
                    itemRefs.current[idx] = el;
                  }
                }}
              >
                <GustCard
                  interactive={!inDuplicate}
                  isActive={isCurrentActive}
                  isMuted={isMuted}
                  onOpenComments={() => setIsCommentsOpen(true)}
                  onToggleMute={handleToggleMute}
                  post={post}
                  shouldMountVideo={shouldMount}
                />
              </div>
            );
          })}

          {isFetchingNextPage ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="text-primary size-6 animate-spin" />
            </div>
          ) : null}

          {/* Pagination sentinel: triggers the next page even when the feed
              is short, keeping the stream effectively infinite. */}
          {hasNextPage ? <div ref={endSentinelRef} /> : null}
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
        {/* Floating back button (mobile, over the video) */}
        <button
          aria-label="Go back"
          className="rail-3d-btn absolute top-4 left-4 z-30 flex h-10 w-10 items-center justify-center rounded-full md:hidden"
          onClick={() => router.back()}
          type="button"
        >
          <ChevronLeft className="size-5" />
        </button>

        {/* Floating back button (desktop, outside the gust container) */}
        <button
          aria-label="Go back"
          className="icon-btn-3d absolute top-4 left-4 z-30 hidden h-10 w-10 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95 md:flex"
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
              className="rail-3d-btn flex h-11 w-11 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95"
              onClick={scrollToPrev}
              type="button"
            >
              <ChevronUp className="size-5" />
            </button>
            <button
              aria-label="Next Gust"
              className="rail-3d-btn flex h-11 w-11 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95"
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
