"use client";

import type { PostData, PostsPage, UserData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Loader2,
  Plus,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useSession } from "@/app/(main)/session-provider";
import { GustCard } from "@/components/gusts/gust-card";
import { GustsCommentsDrawer } from "@/components/gusts/gusts-comments-drawer";
import { UploadGustDialog } from "@/components/gusts/upload-gust-dialog";
import LeftSidebar from "@/components/home/sidebars/left-side-bar";
import MobileTopBar from "@/components/layouts/mobile/mobile-top-bar";
import { useRequireAuth } from "@/hooks/use-require-auth";
import kyInstance from "@/lib/ky";

interface ClientGustsProps {
  loggedInUserData: UserData | null;
}

export const ClientGusts: React.FC<ClientGustsProps> = ({
  loggedInUserData,
}) => {
  const searchParams = useSearchParams();
  const initialPostId = searchParams.get("id");
  const autoOpenCreate = searchParams.get("create") === "true";

  const { user } = useSession();
  const { goToLogin } = useRequireAuth();

  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [isUploadOpen, setIsUploadOpen] = useState(autoOpenCreate);
  const [activeCommentsPost, setActiveCommentsPost] = useState<PostData | null>(
    null
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Infinite query for gusts
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
    refetch,
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

  const handleOpenUpload = useCallback(() => {
    if (!user) {
      goToLogin();
      return;
    }
    setIsUploadOpen(true);
  }, [goToLogin, user]);

  const handleUploadSuccess = useCallback(() => {
    refetch();
  }, [refetch]);

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
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="text-primary size-8 animate-spin" />
            <p className="text-muted-foreground text-sm font-medium">
              Loading Gusts...
            </p>
          </div>
        </div>
      );
    }

    if (posts.length === 0) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center">
          <div className="bg-primary/10 text-primary mb-4 flex h-20 w-20 items-center justify-center rounded-3xl">
            <Clapperboard className="size-10" />
          </div>
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
      <div className="flex h-full w-full max-w-5xl items-center justify-center gap-4 px-2 py-3 md:px-6">
        {/* Scroll Up / Down Navigation Controls for Desktop */}
        <div className="hidden flex-col items-center gap-3 lg:flex">
          <button
            aria-label="Previous Gust"
            className="border-border text-foreground flex h-10 w-10 items-center justify-center rounded-full border bg-[hsl(var(--background-alt))] shadow-md transition-transform hover:scale-110 disabled:opacity-40"
            disabled={activeIndex === 0}
            onClick={scrollToPrev}
            type="button"
          >
            <ChevronUp className="size-5" />
          </button>
          <button
            aria-label="Next Gust"
            className="border-border text-foreground flex h-10 w-10 items-center justify-center rounded-full border bg-[hsl(var(--background-alt))] shadow-md transition-transform hover:scale-110 disabled:opacity-40"
            disabled={activeIndex >= posts.length - 1}
            onClick={scrollToNext}
            type="button"
          >
            <ChevronDown className="size-5" />
          </button>
        </div>

        {/* Vertical Snap Stream */}
        <div
          className="hide-native-scrollbar h-full w-full max-w-md snap-y snap-mandatory overflow-y-auto overscroll-y-contain pt-12 md:pt-0"
          ref={containerRef}
        >
          {posts.map((post, idx) => (
            <div
              className="flex h-full w-full snap-start snap-always items-center justify-center py-2"
              data-index={idx}
              key={post.id}
              ref={(el) => {
                itemRefs.current[idx] = el;
              }}
            >
              <GustCard
                isActive={activeIndex === idx}
                isMuted={isMuted}
                onOpenComments={() => setActiveCommentsPost(post)}
                onOpenUpload={handleOpenUpload}
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

        {/* Slide-out Comments Drawer on desktop when opened */}
        {activeCommentsPost ? (
          <div className="hidden h-full max-h-[calc(100dvh-5rem)] md:block">
            <GustsCommentsDrawer
              isOpen={Boolean(activeCommentsPost)}
              onClose={() => setActiveCommentsPost(null)}
              post={activeCommentsPost}
            />
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
        {/* Mobile top bar */}
        <div className="absolute inset-x-0 top-0 z-30 md:hidden">
          <MobileTopBar />
        </div>

        {renderContent()}

        {/* Mobile slide-up comments drawer */}
        {activeCommentsPost ? (
          <div className="md:hidden">
            <GustsCommentsDrawer
              isOpen={Boolean(activeCommentsPost)}
              onClose={() => setActiveCommentsPost(null)}
              post={activeCommentsPost}
            />
          </div>
        ) : null}

        {/* Upload Gust Modal */}
        <UploadGustDialog
          isOpen={isUploadOpen}
          onClose={() => setIsUploadOpen(false)}
          onSuccess={handleUploadSuccess}
        />
      </div>
    </div>
  );
};
