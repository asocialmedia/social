"use client";

import type { PostData } from "@asm/db";
import noSearchImage from "@assets/general/nosearch.png";
import { useQuery } from "@tanstack/react-query";
import { Eye, Flame, History, MessageSquare } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";

import { ROW_HOVER_CLASS } from "@/components/home/sidebars/right/sidebar-styles";
import kyInstance from "@/lib/ky";
import { cn, formatNumber, formatRelativeDate } from "@/lib/utils";

const getMediaUrl = (mediaId: string) => `/api/media/${mediaId}`;

const HistoryRowSkeleton: React.FC = () => (
  <div className="flex items-center gap-2.5 px-2.5 py-2">
    <div className="bg-border/50 h-12 w-12 shrink-0 animate-pulse rounded-lg" />
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className="bg-border/60 h-3.5 w-full animate-pulse rounded-md" />
      <div className="bg-border/60 h-3.5 w-3/4 animate-pulse rounded-md" />
      <div className="bg-border/40 h-3 w-24 animate-pulse rounded-md" />
    </div>
  </div>
);

interface HistoryRowProps {
  post: PostData;
}

const HistoryRow: React.FC<HistoryRowProps> = ({ post }) => {
  const [firstMedia] = post.attachments;

  return (
    <Link
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-2.5 py-2",
        ROW_HOVER_CLASS
      )}
      href={`/posts/${post.id}`}
    >
      {firstMedia?.type === "IMAGE" || firstMedia?.type === "VIDEO" ? (
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-black shadow-xs">
          {firstMedia.type === "IMAGE" ? (
            <Image
              alt="Post media"
              className="object-cover"
              fill
              sizes="48px"
              src={getMediaUrl(firstMedia.id)}
              unoptimized
            />
          ) : (
            <video
              aria-label="Post video"
              className="absolute inset-0 h-full w-full object-cover"
              muted
              playsInline
              preload="metadata"
              src={getMediaUrl(firstMedia.id)}
            />
          )}
        </div>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {post.user.displayName || post.user.username}
        </span>
        <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-sm leading-snug font-medium">
          {post.content || "View post"}
        </span>
        <span className="text-muted-foreground mt-1 flex items-center gap-2 text-xs transition-colors group-hover:text-inherit">
          <span className="shrink-0" suppressHydrationWarning>
            {formatRelativeDate(post.createdAt)}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            <Flame className="h-3 w-3 text-orange-500 transition-colors group-hover:text-inherit" />
            {formatNumber(post.aura)}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            <MessageSquare className="h-3 w-3" />
            {formatNumber(post._count.comments)}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            <Eye className="h-3 w-3" />
            {formatNumber(post.viewCount)}
          </span>
        </span>
      </span>
    </Link>
  );
};

const PostHistoryCard: React.FC = () => {
  const { data, status } = useQuery({
    queryFn: () =>
      kyInstance.get("/api/posts/history").json<{ posts: PostData[] }>(),
    queryKey: ["post-history"],
    refetchInterval: 30 * 1000,
    refetchIntervalInBackground: false,
    staleTime: 30 * 1000,
  });

  const posts = data?.posts ?? [];

  let body: React.ReactNode;
  if (status === "pending") {
    body = (
      <div className="flex flex-col gap-0.5">
        <HistoryRowSkeleton />
        <HistoryRowSkeleton />
        <HistoryRowSkeleton />
      </div>
    );
  } else if (status === "error") {
    body = (
      <p className="text-muted-foreground px-3 py-2 text-sm">
        Couldn&apos;t load your history.
      </p>
    );
  } else if (posts.length) {
    body = (
      <div className="flex flex-col gap-0.5">
        {posts.slice(0, 12).map((post) => (
          <HistoryRow key={post.id} post={post} />
        ))}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col items-center justify-center gap-1.5 px-3 py-3 text-center">
        <Image
          alt=""
          className="h-16 w-auto object-contain"
          draggable={false}
          height={128}
          src={noSearchImage}
          width={128}
        />
        <p className="text-muted-foreground w-16 text-sm">
          Posts you visit will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="sidebar-subcard rounded-2xl p-2">
      <div className="flex items-center gap-2 px-2 pt-0.5 pb-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.45),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
          <History className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-tight font-semibold">Recents</p>
          <p className="text-primary truncate text-xs leading-tight">
            Recently visited posts
          </p>
        </div>
      </div>
      <div className="pt-2 pb-1">{body}</div>
    </div>
  );
};

export default PostHistoryCard;
