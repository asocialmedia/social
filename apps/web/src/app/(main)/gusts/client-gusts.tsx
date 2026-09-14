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
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useInView } from "react-intersection-observer";

import { useSession } from "@/app/(main)/session-provider";
import { NewContentPill } from "@/components/feeds/new-content-pill";
import type { NewContentAuthor } from "@/components/feeds/new-content-pill";
import { GustCard } from "@/components/gusts/gust-card";
import { GustCardSkeleton } from "@/components/gusts/gust-card-skeleton";
import { GustsCommentsDrawer } from "@/components/gusts/gusts-comments-drawer";
import { AnimatedTabButton } from "@/components/home/feedview/animated-tab-trigger";
import { RecommendationTracker } from "@/components/recommendations/recommendation-tracker";
import { useSpotlight } from "@/components/search/spotlight-provider";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import kyInstance from "@/lib/ky";
import { useComposerStore } from "@/store/composer-store";

interface ClientGustsProps {
  loggedInUserData: UserData | null;
}

export const ClientGusts: React.FC<ClientGustsProps> = () => {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const initialPostId = searchParams.get("id");
  const { user } = useSession();
  const { goToLogin } = useRequireAuth();
  const openComposer = useComposerStore((state) => state.openComposer);
  const { openSpotlight } = useSpotlight();
  const autoOpenCreate = searchParams.get("create") === "true";
  const queryClient = useQueryClient();
  const isLoggedIn = Boolean(user);
  const requestedTab = searchParams.get("tab");
  const defaultTab = isLoggedIn ? "personalized" : "latest";
  const gustTab =
    requestedTab === "latest" || requestedTab === "personalized"
      ? requestedTab
      : defaultTab;
  const isPersonalized = gustTab === "personalized" && !initialPostId;

  const handleTabChange = useCallback(
    (value: "latest" | "personalized") => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (value === defaultTab) {
        nextParams.delete("tab");
      } else {
        nextParams.set("tab", value);
      }
      const query = nextParams.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [defaultTab, pathname, router, searchParams]
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [hiddenPostIds, setHiddenPostIds] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    const handleNotInterested = (event: Event) => {
      const postId = (event as CustomEvent<{ postId?: string }>).detail?.postId;
      if (!postId) {
        return;
      }
      setHiddenPostIds((current) => new Set([...current, postId]));
    };
    window.addEventListener(
      "recommendation:not-interested",
      handleNotInterested
    );
    return () => {
      window.removeEventListener(
        "recommendation:not-interested",
        handleNotInterested
      );
    };
  }, []);

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
  const [newGusts, setNewGusts] = useState<PostsPage["posts"]>([]);
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
    queryFn: ({ pageParam }: { pageParam: string | null }) => {
      // Moderated gusts never render in the stream (same as the explore rail).
      const queryParams: Record<string, string> = {
        excludeModerated: "1",
      };
      if (isPersonalized) {
        queryParams.mode = "personalized";
      }
      if (pageParam) {
        queryParams.cursor = pageParam;
      } else if (initialPostId) {
        queryParams.initialId = initialPostId;
      }
      return kyInstance
        .get("/api/gusts", { searchParams: queryParams })
        .json<PostsPage>();
    },
    queryKey: ["gusts-feed", initialPostId, gustTab, user?.id ?? "guest"],
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: 1000 * 60,
  });

  // Reset the reel position after switching between Latest and For you. The
  // microtask keeps the state update out of the effect's synchronous phase.
  useEffect(() => {
    queueMicrotask(() => {
      setActiveIndex(0);
      setNewGusts([]);
    });
    containerRef.current?.scrollTo({ top: 0 });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- gustTab is intentionally a change signal for the new query
  }, [gustTab]);

  const posts = useMemo(
    () =>
      (data?.pages.flatMap((page) => page.posts) || [])
        // Drop moderated stragglers from stale cached pages so a gust that
        // gets moderated mid-session disappears instead of lingering.
        .filter((post) => !post.moderated)
        .filter((post) => !hiddenPostIds.has(post.id))
        .filter((post) => post.attachments.some((m) => m.type === "VIDEO")),
    [data?.pages, hiddenPostIds]
  );

  const findUnseenGusts = useCallback(
    (fresh: PostsPage["posts"]): PostsPage["posts"] => {
      const knownIds = new Set(posts.map((post) => post.id));
      const unseen: PostsPage["posts"] = [];
      for (const post of fresh) {
        if (!post.attachments.some((media) => media.type === "VIDEO")) {
          continue;
        }
        if (knownIds.has(post.id)) {
          break;
        }
        unseen.push(post);
      }
      return unseen;
    },
    [posts]
  );

  // Pull-to-refresh updates the visible reel immediately. Background polling
  // below only probes the head so scrolling never jumps unexpectedly.
  const refreshFeed = useCallback(async () => {
    if (isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    try {
      const result = await refetch();
      const fresh = result.data?.pages.flatMap((page) => page.posts) ?? [];
      setNewGusts(findUnseenGusts(fresh));
    } catch (error) {
      // Reset before rethrowing so the refresh UI clears on the failure path
      // too (replaces the previous `finally` clause).
      setIsRefreshing(false);
      setPullDistance(0);
      throw error;
    }
    setIsRefreshing(false);
    setPullDistance(0);
    // oxlint-disable-next-line react/memo-dependencies -- refetch is lexically captured; React Query guarantees it has a stable identity
  }, [findUnseenGusts, isRefreshing, refetch]);

  // Probe only the first page. Keeping this outside the main infinite query
  // means React Query retains the visible cached reel while this request runs.
  useEffect(() => {
    if (initialPostId) {
      return;
    }
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const queryParams: Record<string, string> = {
            excludeModerated: "1",
          };
          if (isPersonalized) {
            queryParams.mode = "personalized";
          }
          const fresh = await kyInstance
            .get("/api/gusts", { searchParams: queryParams })
            .json<PostsPage>();
          const unseen = findUnseenGusts(fresh.posts);
          if (unseen.length > 0) {
            setNewGusts(unseen);
          }
        } catch {
          // Best-effort polling; keep the current reel on transient failures.
        }
      })();
    }, 45 * 1000);
    return () => window.clearInterval(interval);
  }, [findUnseenGusts, initialPostId, isPersonalized]);

  // Jump to the very first gust and clear the new-gust pill.
  const showNewGusts = useCallback(() => {
    containerRef.current?.scrollTo({ behavior: "smooth", top: 0 });
    setNewGusts([]);
  }, []);

  // Kept in sync so the wheel/touch listeners (attached once) can consult the
  // current value without re-binding on every fetch state change.
  const hasNextPageRef = useRef(hasNextPage);
  useEffect(() => {
    hasNextPageRef.current = hasNextPage;
  }, [hasNextPage]);

  // Scrolls the stream so the gust at `idx` is in view, computing the target
  // directly on the scroll container.
  const scrollToItem = useCallback((idx: number) => {
    const container = containerRef.current;
    const el = itemRefs.current[idx];
    if (!container || !el) {
      return;
    }
    const target = el.offsetTop - container.offsetTop;
    container.scrollTo({ behavior: "smooth", top: target });
  }, []);

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
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- posts.length intentionally re-runs this effect so the touch listeners attach once the scroll container mounts
  }, [isRefreshing, posts.length, pullDistance, refreshFeed]);

  // If ?id= was provided, jump straight to that gust once the feed is loaded:
  // mark it active (so its video plays) and center it in the stream container
  // instantly.
  const lastJumpedPostIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !initialPostId ||
      posts.length === 0 ||
      lastJumpedPostIdRef.current === initialPostId
    ) {
      return;
    }
    const idx = posts.findIndex((post) => post.id === initialPostId);
    if (idx === -1) {
      return;
    }
    lastJumpedPostIdRef.current = initialPostId;
    // Deferred to a microtask so the effect body never calls setState
    // synchronously while jumping to the ?id= gust.
    queueMicrotask(() => {
      setActiveIndex(idx);
    });
    const container = containerRef.current;
    const el = itemRefs.current[idx];
    if (container && el) {
      const target = el.offsetTop - container.offsetTop;
      container.scrollTo({ behavior: "smooth", top: Math.max(0, target) });
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
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- posts.length intentionally re-runs this effect so new gust cards get observed
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

  const scrollToPrev = useCallback(() => {
    if (activeIndex > 0) {
      const prevIndex = activeIndex - 1;
      setActiveIndex(prevIndex);
      scrollToItem(prevIndex);
    }
  }, [activeIndex, scrollToItem]);

  const scrollToNext = useCallback(() => {
    if (activeIndex < posts.length - 1) {
      const nextIndex = activeIndex + 1;
      setActiveIndex(nextIndex);
      scrollToItem(nextIndex);
    }
  }, [activeIndex, posts.length, scrollToItem]);

  // Keyboard navigation for desktop: arrow down/up, j/k to jump between
  // gusts, m to toggle mute.
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
        scrollToNext();
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        scrollToPrev();
      } else if (e.key === "m") {
        e.preventDefault();
        handleToggleMute();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleToggleMute, scrollToNext, scrollToPrev]);

  // Record a visit for the active gust so the recents card surfaces it and
  // keeps the "recently viewed" order fresh. Guests don't have history.
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
          {posts.map((post, idx) => {
            const isCurrentActive = activeIndex === idx;
            const distance = Math.abs(idx - activeIndex);
            const shouldMount = isCurrentActive || distance <= 1;

            return (
              <div
                className="flex h-full w-full snap-start snap-always items-center justify-center py-0 sm:h-[98%] sm:py-2"
                data-index={idx}
                key={post.id}
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
              >
                <RecommendationTracker postId={post.id}>
                  <GustCard
                    interactive
                    isActive={isCurrentActive}
                    isMuted={isMuted}
                    onOpenComments={() => setIsCommentsOpen(true)}
                    onToggleMute={handleToggleMute}
                    post={post}
                    shouldMountVideo={shouldMount}
                  />
                </RecommendationTracker>
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
    <>
      {/* Main Gusts Container */}
      <div className="relative flex min-w-0 flex-1 justify-center overflow-hidden bg-[hsl(var(--background-alt))]">
        <div className="pointer-events-none absolute top-0 right-0 left-0 z-30 flex justify-center pt-1.5">
          <div className="border-border/60 pointer-events-auto flex items-center rounded-b-xl border bg-[hsl(var(--background-alt))]/85 px-1 backdrop-blur-md">
            <AnimatedTabButton
              active={gustTab === "latest"}
              layoutId="gust-tab-indicator"
              onClick={() => handleTabChange("latest")}
            >
              Latest
            </AnimatedTabButton>
            <AnimatedTabButton
              active={gustTab === "personalized"}
              layoutId="gust-tab-indicator"
              onClick={() => handleTabChange("personalized")}
            >
              For you
            </AnimatedTabButton>
          </div>
        </div>
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
          {newGusts.length > 0 ? (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="absolute top-4 left-1/2 z-30 -translate-x-1/2"
              exit={{ opacity: 0, y: -12 }}
              initial={{ opacity: 0, y: -12 }}
            >
              <NewContentPill
                authors={[
                  ...new Map<string, NewContentAuthor>(
                    newGusts.map((post) => [
                      post.userId,
                      {
                        avatarUrl: post.user?.avatarUrl,
                        id: post.userId,
                        username: post.user?.username,
                      },
                    ])
                  ).values(),
                ]}
                count={newGusts.length}
                noun="gust"
                onClick={showNewGusts}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>

        {status === "success" && posts.length > 0 ? (
          <div className="fixed top-1/2 right-4 z-40 hidden -translate-y-1/2 flex-col items-center gap-3 md:flex">
            <button
              aria-label="Previous Gust"
              className="rail-3d-btn flex h-11 w-11 cursor-pointer items-center justify-center rounded-full shadow-md transition-all duration-150 hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
              disabled={activeIndex <= 0}
              onClick={scrollToPrev}
              type="button"
            >
              <ChevronUp className="size-5" />
            </button>
            <button
              aria-label="Next Gust"
              className="rail-3d-btn flex h-11 w-11 cursor-pointer items-center justify-center rounded-full shadow-md transition-all duration-150 hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
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
    </>
  );
};
