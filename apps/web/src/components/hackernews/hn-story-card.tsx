"use client";

import type { HNStory } from "@asm/aggregator/hackernews";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { useHnShareStore } from "@asm/ui/store/hn-share-store";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowUpRight,
  Bookmark,
  Clock,
  Link as LinkIcon,
  MessageCircle,
  MoreHorizontal,
  Share2,
  ThumbsUp,
  User,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { useCallback } from "react";
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
      "flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-linear-to-b from-[#ff9500] to-[#e65500] font-bold text-[10px] text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_1px_2px_rgba(154,52,18,0.3)]",
      className
    )}
  >
    Y
  </span>
);

export function HNStoryCard({ story, initialBookmarked }: HNStoryCardProps) {
  const domain = story.url ? new URL(story.url).hostname : null;
  const timeAgo = formatDistanceToNow(story.time * 1000, { addSuffix: true });
  const hnItemUrl = `https://news.ycombinator.com/item?id=${story.id}`;
  const router = useRouter();
  const hnShareStore = useHnShareStore();
  const queryClient = useQueryClient();

  const isBatched = initialBookmarked !== undefined;

  const { data: bookmarkData } = useQuery({
    queryKey: ["hn-bookmark", story.id],
    queryFn: async () => {
      const response = await fetch(`/api/hackernews/${story.id}/bookmark`);
      if (!response.ok) {
        throw new Error("Failed to fetch bookmark status");
      }
      return response.json() as Promise<{ isBookmarked: boolean }>;
    },
    enabled: !isBatched,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const isBookmarked = isBatched
    ? initialBookmarked
    : bookmarkData?.isBookmarked;

  const { mutate: toggleBookmark } = useMutation({
    mutationFn: async () => {
      const method = isBookmarked ? "DELETE" : "POST";
      await fetch(`/api/hackernews/${story.id}/bookmark`, { method });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hn-bookmark", story.id] });
      queryClient.invalidateQueries({ queryKey: ["hn-bookmarks"] });
      queryClient.invalidateQueries({ queryKey: ["bookmark-count"] });
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
      id: story.id,
      title: story.title,
      url: story.url,
      by: story.by,
      time: story.time,
      score: story.score,
      descendants: story.descendants,
      type: story.type,
    });
    toast({
      title: "Story Ready",
      description: "Add your thoughts and share it with your followers!",
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
          title: "Link Copied",
          description: "Link copied, paste it anywhere",
        });
      }
    } catch {
      // Silently fail if clipboard/native share is unavailable
    }
  }, [hnItemUrl, story.title, story.url]);
  const handleVisit = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation();
  }, []);

  const handleOpenComments = useCallback(() => {
    window.open(hnItemUrl, "_blank", "noopener,noreferrer");
  }, [hnItemUrl]);

  const handleOpenStory = useCallback(() => {
    window.open(story.url || hnItemUrl, "_blank", "noopener,noreferrer");
  }, [hnItemUrl, story.url]);

  const handleToggleBookmark = useCallback(() => {
    toggleBookmark(undefined, {
      onSuccess: () => {
        toast({
          title: isBookmarked ? "Removed" : "Saved",
          description: isBookmarked
            ? "Story removed from your bookmarks."
            : "Story saved to your bookmarks.",
        });
      },
    });
  }, [isBookmarked, toggleBookmark]);

  return (
    <div className="group relative flex flex-col gap-1.5 p-3 transition-colors duration-150 hover:bg-[hsl(var(--muted))] sm:p-3.5">
      <div className="pointer-events-none absolute inset-0 -z-10 rounded-2xl bg-linear-to-r from-orange-500/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HNLogo />
          <span className="font-semibold text-[10px] text-orange-600 uppercase tracking-wide dark:text-orange-400">
            Hacker News
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground/70 tabular-nums">
            <Clock className="h-3 w-3" />
            {timeAgo}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Story options"
                className="pill-3d-hover group inline-flex h-8 w-8 items-center justify-center rounded-full border-0 p-0 text-muted-foreground active:translate-y-px"
                type="button"
              >
                <MoreHorizontal className="size-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="apple-panel p-1.5 shadow-none"
            >
              <DropdownMenuItem
                className="pill-3d-hover rounded-md px-2 py-2"
                onClick={handleOpenComments}
              >
                <span className="flex items-center gap-3">
                  <MessageCircle className="size-4" />
                  Comments
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="pill-3d-hover rounded-md px-2 py-2"
                onClick={handleShare}
              >
                <span className="flex items-center gap-3">
                  <Share2 className="size-4" />
                  Share
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="pill-3d-hover rounded-md px-2 py-2"
                onClick={handleShareToAsocialmedia}
              >
                <span className="flex items-center gap-3">
                  <Share2 className="size-4 rotate-90" />
                  Share to Asocialmedia
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="pill-3d-hover rounded-md px-2 py-2"
                onClick={handleToggleBookmark}
              >
                <span className="flex items-center gap-3">
                  <Bookmark
                    className={cn("size-4", isBookmarked && "fill-current")}
                  />
                  {isBookmarked ? "Remove bookmark" : "Save"}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="pill-3d-hover rounded-md px-2 py-2"
                onClick={handleOpenStory}
              >
                <span className="flex items-center gap-3">
                  <ArrowUpRight className="size-4" />
                  Visit
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex items-start justify-between gap-3">
        <a
          className="line-clamp-2 min-w-0 flex-1 font-semibold text-foreground text-sm leading-snug transition-colors hover:text-orange-600 dark:hover:text-orange-400"
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
        <a
          className="hn-link dark:text-orange-400"
          href={hnItemUrl}
          onClick={handleVisit}
          rel="noopener noreferrer"
          target="_blank"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          <span>Comments</span>
        </a>

        <button
          className="hn-link dark:text-orange-400"
          onClick={handleShare}
          type="button"
        >
          <Share2 className="h-3.5 w-3.5" />
          <span>Share</span>
        </button>

        <button
          className="hn-link dark:text-orange-400"
          onClick={handleShareToAsocialmedia}
          type="button"
        >
          <Share2 className="h-3.5 w-3.5 rotate-90" />
          <span>Share to Asocialmedia</span>
        </button>

        <button
          className={cn(
            "hn-link dark:text-orange-400",
            isBookmarked &&
              "bg-linear-to-b from-[#ff9500] to-[#e65500] font-medium text-white! shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.4),0_1px_1px_rgba(255,255,255,0.4),0_2px_4px_rgba(0,0,0,0.08)] dark:text-white!"
          )}
          onClick={handleToggleBookmark}
          type="button"
        >
          <Bookmark
            className={cn("h-3.5 w-3.5", isBookmarked && "fill-current")}
          />
          <span>{isBookmarked ? "Saved" : "Save"}</span>
        </button>

        {story.url ? (
          <a
            className="hn-link ml-auto dark:text-orange-400"
            href={story.url}
            onClick={handleVisit}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            <span>Visit</span>
          </a>
        ) : null}
      </div>
    </div>
  );
}
