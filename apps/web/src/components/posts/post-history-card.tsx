"use client";

import type { PostData } from "@asm/db";
import noSearchImage from "@assets/general/nosearch.png";
import { useQuery } from "@tanstack/react-query";
import {
  Eye,
  Flame,
  History,
  MessageSquare,
  Play,
  ShieldAlert,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";

import { ROW_HOVER_CLASS } from "@/components/home/sidebars/right/sidebar-styles";
import UserBadge from "@/components/layouts/user-badge";
import ExplicitContentGate from "@/components/posts/explicit-content-gate";
import { getAuraFlameClass } from "@/lib/aura";
import kyInstance from "@/lib/ky";
import { cn, formatNumber, formatRelativeDate } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

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
      href={post.isGust ? `/gusts?id=${post.id}` : `/posts/${post.id}`}
    >
      {firstMedia?.type === "IMAGE" || firstMedia?.type === "VIDEO" ? (
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-black shadow-xs">
          {post.explicitContent ? (
            <ExplicitContentGate
              revealKey={post.id}
              className="h-full w-full"
              compact
              label="Explicit"
            >
              <Image
                alt="Post media"
                className="object-cover"
                fill
                sizes="48px"
                src={getMediaProxyUrl(firstMedia)}
                unoptimized
              />
            </ExplicitContentGate>
          ) : (
            <Image
              alt="Post media"
              className="object-cover"
              fill
              sizes="48px"
              src={getMediaProxyUrl(firstMedia)}
              unoptimized
            />
          )}
          {firstMedia.type === "VIDEO" && !post.explicitContent ? (
            <span className="absolute inset-0 m-auto flex size-5 items-center justify-center rounded-full bg-black/40 backdrop-blur-xs">
              <Play className="h-3 w-3 fill-white text-white" />
            </span>
          ) : null}
        </div>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="block truncate text-sm font-semibold">
            {post.user.displayName || post.user.username}
          </span>
          <UserBadge badge={post.user.badge} badges={post.user.badges} />
        </span>

        {post.moderated ? (
          <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-sm leading-snug font-medium">
            <ShieldAlert className="size-3.5 shrink-0" />
            <span className="truncate">This post seemed harmful</span>
          </span>
        ) : (
          // Hard cap on the row: clamp the content to two lines so a long post
          // never stretches the recents card (max-h-10 = 2 lines at leading-snug).
          <span className="text-muted-foreground mt-0.5 line-clamp-2 block max-h-10 overflow-hidden text-sm leading-snug font-medium">
            {post.content || "View post"}
          </span>
        )}

        <span className="text-muted-foreground mt-1 flex items-center gap-2 text-xs transition-colors group-hover:text-inherit">
          <span className="shrink-0" suppressHydrationWarning>
            {formatRelativeDate(post.createdAt)}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            <Flame
              className={cn(
                "h-3 w-3 transition-colors group-hover:text-inherit",
                getAuraFlameClass(post.aura)
              )}
            />
            {formatNumber(post.aura)}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            <MessageSquare
              className={cn(
                "h-3 w-3",
                post._count.comments > 0 && "fill-current"
              )}
            />
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
      <div className="flex items-center gap-2 px-2 pt-0.5 pb-1">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.45),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
          <History className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-tight font-semibold">Recents</p>
          <p className="text-foreground/80 truncate text-xs leading-tight font-medium">
            Recently visited posts
          </p>
        </div>
      </div>
      <div className="pb-1">{body}</div>
    </div>
  );
};

export default PostHistoryCard;
