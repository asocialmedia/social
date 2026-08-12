"use client";

import { Badge } from "@asm/ui/shadui/badge";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowUpRight,
  Link as LinkIcon,
  MessageCircle,
  ThumbsUp,
  User,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";

interface HnStoryCardProps {
  hnStory: {
    storyId: number;
    title: string;
    url?: string | null;
    by: string;
    time: number;
    score: number;
    descendants: number;
  };
}

export function HNStoryCard({ hnStory }: HnStoryCardProps) {
  const domain = hnStory.url ? new URL(hnStory.url).hostname : null;
  const timeAgo = formatDistanceToNow(hnStory.time * 1000, { addSuffix: true });
  const hnItemUrl = `https://news.ycombinator.com/item?id=${hnStory.storyId}`;

  return (
    <div className="flex flex-col gap-1.5 p-3 sm:p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-b from-[#ff9500] to-[#e65500] font-bold text-[10px] text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_1px_2px_rgba(154,52,18,0.3)]">
            Y
          </div>
          <span className="font-semibold text-[10px] text-orange-600 uppercase tracking-wide dark:text-orange-400">
            Hacker News
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground/70 tabular-nums">
          {timeAgo}
        </span>
      </div>

      <div className="flex items-start justify-between gap-3">
        <a
          className="line-clamp-2 min-w-0 flex-1 font-semibold text-foreground text-sm leading-snug transition-colors hover:text-orange-600"
          href={hnStory.url || hnItemUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          {hnStory.title}
        </a>
        {domain ? (
          <Badge
            className="hn-chip mt-0.5 w-fit max-w-[40%] shrink-0 px-2 py-0.5 font-normal dark:text-orange-400"
            variant="secondary"
          >
            <LinkIcon className="mr-1 h-3 w-3 shrink-0" />
            <span className="truncate">{domain}</span>
          </Badge>
        ) : null}
      </div>

      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
        <div className="hn-chip">
          <User className="h-3 w-3" />
          <span className="max-w-[70px] cursor-default truncate sm:max-w-[90px]">
            {hnStory.by}
          </span>
        </div>

        <div className="hn-chip">
          <ThumbsUp className="h-3 w-3" />
          <span className="cursor-default tabular-nums">
            {hnStory.score} pts
          </span>
        </div>

        <div className="hn-chip">
          <MessageCircle className="h-3 w-3" />
          <a
            className="hover:text-inherit"
            href={hnItemUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span className="tabular-nums">{hnStory.descendants}</span>
            <span className="hidden sm:inline">
              {" "}
              {hnStory.descendants === 1 ? "comment" : "comments"}
            </span>
          </a>
        </div>
      </div>

      <div className="mt-0.5 flex items-center justify-between gap-2 border-orange-500/15 border-t pt-1.5">
        <Link className="hn-link dark:text-orange-400" href="/hackernews">
          <span>Browse HN</span>
          <motion.span
            animate={{ x: 0 }}
            className="inline-block"
            whileHover={{ x: 3 }}
          >
            →
          </motion.span>
        </Link>

        <a
          className="hn-link dark:text-orange-400"
          href={hnStory.url || hnItemUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
          <span>View original</span>
        </a>
      </div>
    </div>
  );
}
