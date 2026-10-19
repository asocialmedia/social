"use client";

import type { ExternalPost } from "@asm/protocols/contracts";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import noMediaImage from "@assets/general/nomedia.png";
import { Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import { BlueskyIcon } from "@/components/protocols/bluesky-icon";
import { ExternalLikeButton } from "@/components/protocols/external-like-button";
import { RecommendationTracker } from "@/components/recommendations/recommendation-tracker";
import { SuggestedFollowButton } from "@/components/recommendations/suggested-follow-button";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { externalNetworkPostAllowed } from "@/lib/posts/network-content-policy";
import { blueskyMediaIsExplicit } from "@/lib/protocols/content-labels";
import type { RecommendedAccount } from "@/lib/recommendations/suggestion-types";
import { cn } from "@/lib/utils";

export function ExploreNetworkAccount({
  account,
}: {
  account: RecommendedAccount;
}) {
  return (
    <article
      className="surface-3d mb-4 break-inside-avoid overflow-hidden rounded-2xl! p-4"
      data-source={account.source}
    >
      <Link
        className="flex min-w-0 flex-col items-center gap-2 text-center"
        href={account.href}
      >
        <UserAvatar
          avatarUrl={account.avatarUrl}
          seed={account.id}
          className="size-16"
          size={64}
        />
        <span className="flex max-w-full items-center gap-1 text-sm font-semibold">
          <span className="truncate">{account.displayName}</span>
          {account.source === "bluesky" ? (
            <BlueskyIcon className="size-3.5 shrink-0" />
          ) : null}
        </span>
        <span className="text-muted-foreground w-full truncate text-xs">
          @{account.handle}
        </span>
      </Link>
      <p className="text-muted-foreground my-3 line-clamp-2 text-center text-xs">
        {account.reason}
      </p>
      <SuggestedFollowButton account={account} />
    </article>
  );
}

export function ExploreNetworkPost({
  post,
  gust = false,
}: {
  post: ExternalPost;
  gust?: boolean;
}) {
  const network = useNetworkSettings();
  const [imageState, setImageState] = useState<"loading" | "loaded" | "failed">(
    "loading"
  );
  const [media] = post.media;
  const thumbnail =
    media?.type === "image"
      ? (media.thumbnailUrl ?? media.url)
      : (media?.thumbnailUrl ?? post.externalLink?.thumbnailUrl);
  const explicit = blueskyMediaIsExplicit(post);
  const href = gust
    ? `/gusts?id=${encodeURIComponent(post.id)}`
    : `/network/bluesky?uri=${encodeURIComponent(post.id)}`;
  let aspectRatio = "4 / 5";
  if (gust) {
    aspectRatio = "9 / 16";
  } else if (media?.width && media.height) {
    aspectRatio = `${media.width} / ${media.height}`;
  }
  if (
    !externalNetworkPostAllowed(
      post,
      network.settings.preferences,
      network.settings.topicScope
    )
  ) {
    return null;
  }
  return (
    <RecommendationTracker
      networkSource={post.source}
      networkToken={post.networkRecommendationToken}
      postId={post.id}
    >
      <article
        className={cn(
          "surface-3d group break-inside-avoid overflow-hidden rounded-2xl!",
          !gust && "mb-4"
        )}
        data-source="bluesky"
        data-post-id={post.id}
      >
        <Link className="block" href={href}>
          {thumbnail || gust ? (
            <div
              className="bg-muted relative overflow-hidden"
              style={{ aspectRatio }}
            >
              {thumbnail && imageState !== "failed" ? (
                <Image
                  alt={media?.alt || "Post preview"}
                  onLoad={() => setImageState("loaded")}
                  onError={() => setImageState("failed")}
                  className={cn(
                    "absolute inset-0 size-full object-cover transition-transform group-hover:scale-105",
                    explicit && "blur-lg saturate-50"
                  )}
                  src={thumbnail}
                  fill
                  sizes="(max-width: 768px) 50vw, 300px"
                  unoptimized
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
              {thumbnail && imageState === "loading" ? (
                <Skeleton className="absolute inset-0 size-full rounded-none" />
              ) : null}
              {imageState === "failed" ? (
                <Image
                  alt="Preview unavailable"
                  src={noMediaImage}
                  className="object-contain opacity-50"
                  fill
                  sizes="300px"
                />
              ) : null}
              {media?.type === "video" ? (
                <Play
                  aria-label="Video"
                  className="absolute top-1/2 left-1/2 size-10 -translate-1/2 fill-white text-white drop-shadow"
                />
              ) : null}
              <span className="chip-3d absolute top-2 left-2 flex items-center gap-1 rounded-full! px-2 py-1 text-[10px] font-semibold">
                <BlueskyIcon className="size-3" />
                {gust ? "Gust" : "Bluesky"}
              </span>
            </div>
          ) : null}
          <div className="space-y-3 p-3">
            <p className="line-clamp-4 text-sm leading-snug">
              {post.text || post.externalLink?.title || "Media post"}
            </p>
            <div className="flex items-center gap-2">
              <UserAvatar
                avatarUrl={post.author.avatarUrl}
                seed={post.author.id}
                className="size-8"
                size={32}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-xs font-medium">
                  <span className="truncate">
                    {post.author.displayName || post.author.handle}
                  </span>
                  <BlueskyIcon className="size-3 shrink-0" />
                </span>
                <span className="text-muted-foreground block truncate text-[11px]">
                  @{post.author.handle}
                </span>
              </span>
            </div>
          </div>
        </Link>
        <div className="px-3 pb-3">
          <ExternalLikeButton post={post} />
        </div>
      </article>
    </RecommendationTracker>
  );
}
