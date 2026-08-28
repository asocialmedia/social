"use client";

import type { HNStory } from "@asm/aggregator/hackernews";
import { useHnShareStore } from "@asm/ui/store/hn-share-store";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Bookmark,
  Clock,
  Copy,
  Link as LinkIcon,
  MessageCircle,
  Share2,
  ThumbsUp,
  User,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { useCallback, useEffect } from "react";

import { adjustBookmarkCount } from "@/hooks/use-bookmark-count";
import { toast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

interface HNStoryCardProps {
  initialBookmarked?: boolean;
  story: HNStory;
}

// Y logo badge styled with the same 3D orange gradient used across the new UI
const HNLogo: React.FC<{ className?: string }> = ({ className }) => (
  <span
    aria-hidden="true"
    className={cn(
      "flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-linear-to-b from-[#ff9500] to-[#e65500] text-[10px] font-bold text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_1px_2px_rgba(154,52,18,0.3)]",
      className
    )}
  >
    Y
  </span>
);

export const HNStoryCard = ({ story, initialBookmarked }: HNStoryCardProps) => {
  const domain = story.url ? new URL(story.url).hostname : null;
  const timeAgo = formatDistanceToNow(story.time * 1000, { addSuffix: true });
  const hnItemUrl = `https://news.ycombinator.com/item?id=${story.id}`;
  const router = useRouter();
  const hnShareStore = useHnShareStore();
  const queryClient = useQueryClient();

  // Deferred persisted-state hydration (see hn-share-store): after mount so
  // the SSR'd card and the client's first render agree.
  useEffect(() => {
    void useHnShareStore.persist.rehydrate();
  }, []);

  const isBatched = initialBookmarked !== undefined;

  const { data: bookmarkData } = useQuery({
    enabled: !isBatched,
    queryFn: async () => {
      const response = await fetch(`/api/hackernews/${story.id}/bookmark`);
      if (!response.ok) {
        throw new Error("Failed to fetch bookmark status");
      }
      return response.json() as Promise<{ isBookmarked: boolean }>;
    },
    queryKey: ["hn-bookmark", story.id],
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 30_000,
  });

  const isBookmarked = isBatched
    ? initialBookmarked
    : bookmarkData?.isBookmarked;

  const { mutate: toggleBookmark } = useMutation({
    mutationFn: async () => {
      const method = isBookmarked ? "DELETE" : "POST";
      await fetch(`/api/hackernews/${story.id}/bookmark`, { method });
    },
    onError: () => {
      adjustBookmarkCount(queryClient, "hn", isBookmarked ? 1 : -1);
    },
    onMutate: () => {
      adjustBookmarkCount(queryClient, "hn", isBookmarked ? -1 : 1);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ["bookmark-count"],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hn-bookmark", story.id] });
      queryClient.invalidateQueries({ queryKey: ["hn-bookmarks"] });
      queryClient.setQueriesData<Record<number, boolean>>(
        { queryKey: ["hn-bookmark-states"] },
        (old) => ({
          ...old,
          [story.id]: !isBookmarked,
        })
      );
    },
  });

  const handleShareToAsocialmedia = useCallback(() => {
    hnShareStore.startSharing({
      by: story.by,
      descendants: story.descendants,
      id: story.id,
      score: story.score,
      time: story.time,
      title: story.title,
      type: story.type,
      url: story.url,
    });
    toast({
      description: "Add your thoughts and share it with your followers!",
      title: "Story Ready",
    });
    router.push("/");
  }, [hnShareStore, router, story]);

  const handleShare = useCallback(async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: story.title,
          url: story.url || hnItemUrl,
        });
      } else {
        await navigator.clipboard.writeText(story.url || hnItemUrl);
        toast({
          description: "Link copied, paste it anywhere",
          title: "Link Copied",
        });
      }
    } catch {
      // Silently fail if clipboard/native share is unavailable
    }
  }, [hnItemUrl, story.title, story.url]);
  const handleVisit = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation();
  }, []);

  const handleToggleBookmark = useCallback(() => {
    toggleBookmark(undefined, {
      onSuccess: () => {
        toast({
          description: isBookmarked
            ? "Story removed from your bookmarks."
            : "Story saved to your bookmarks.",
          title: isBookmarked ? "Removed" : "Saved",
        });
      },
    });
  }, [isBookmarked, toggleBookmark]);

  return (
    <div className="group relative flex flex-col gap-1.5 p-3 transition-colors duration-150 hover:bg-[hsl(var(--muted))] sm:p-3.5">
      <div className="pointer-events-none absolute inset-0 -z-10 rounded-2xl bg-linear-to-r from-orange-500/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <HNLogo />
          <span className="text-[10px] font-semibold tracking-wide text-orange-600 uppercase dark:text-orange-400">
            Hacker News
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground/70 flex items-center gap-1 text-[11px] tabular-nums">
            <Clock className="h-3 w-3" />
            {timeAgo}
          </span>
          {/* Save control at the card's top-right, matching post cards. */}
          <button
            aria-label={isBookmarked ? "Remove bookmark" : "Save story"}
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-full border-0 transition-all duration-200 ease-out outline-none active:translate-y-px",
              !isBookmarked && "text-muted-foreground pill-3d-hover",
              isBookmarked &&
                "bg-linear-to-b from-[#fbbf24] to-[#d97706] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(150,90,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
            )}
            onClick={handleToggleBookmark}
            type="button"
          >
            <Bookmark className={cn("size-4", isBookmarked && "fill-white")} />
          </button>
        </div>
      </div>

      <div className="flex items-start justify-between gap-3">
        <a
          className="text-foreground line-clamp-2 min-w-0 flex-1 text-sm leading-snug font-semibold transition-colors hover:text-orange-600 dark:hover:text-orange-400"
          href={story.url || hnItemUrl}
          onClick={handleVisit}
          rel="noopener noreferrer"
          target="_blank"
        >
          {story.title}
        </a>
        {domain ? (
          <span className="hn-chip mt-0.5 w-fit max-w-[40%] shrink-0 px-2 py-0.5 font-normal">
            <LinkIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{domain}</span>
          </span>
        ) : null}
      </div>

      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
        <div className="hn-chip">
          <User className="h-3 w-3" />
          <a
            className="max-w-17.5 truncate sm:max-w-22.5"
            href={`https://news.ycombinator.com/user?id=${story.by}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            {story.by}
          </a>
        </div>

        <div className="hn-chip">
          <ThumbsUp className="h-3 w-3" />
          <span className="tabular-nums">{story.score} pts</span>
        </div>

        <div className="hn-chip">
          <MessageCircle className="h-3 w-3" />
          <a href={hnItemUrl} rel="noopener noreferrer" target="_blank">
            <span className="tabular-nums">{story.descendants}</span>
            <span className="hidden sm:inline">
              {" "}
              {story.descendants === 1 ? "comment" : "comments"}
            </span>
          </a>
        </div>
      </div>

      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 pt-2">
        <button
          className="hn-link dark:text-orange-400"
          onClick={handleShareToAsocialmedia}
          type="button"
        >
          <Share2 className="h-3.5 w-3.5 rotate-90" />
          <span>Reshare as fleet</span>
        </button>

        <button
          className="hn-link ml-auto dark:text-orange-400"
          onClick={handleShare}
          type="button"
        >
          <Copy className="h-3.5 w-3.5" />
          <span>Copy</span>
        </button>
      </div>
    </div>
  );
};
