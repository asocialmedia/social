import type { FeedSource } from "@asm/protocols/discovery";
import { postPreviewLayout } from "@asm/ui/lib/post-preview-layout";
import type { PostPreviewSource } from "@asm/ui/lib/post-preview-layout";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import type * as React from "react";

import { BlueskyIcon } from "@/components/protocols/bluesky-icon";
import { cn } from "@/lib/utils";

export interface DynamicSkeletonProfile {
  albumCount?: number;
  aspectRatio?: number;
  kind: "album" | "image" | "vertical" | "text" | "unknown";
  textLines: number;
}

// Varied profiles representing realistic feed posts: albums, text, landscape images, and vertical portraits.
export const DYNAMIC_SKELETON_PROFILES: readonly DynamicSkeletonProfile[] = [
  // 0: Multi-image album (2 images) with 2 lines of text
  {
    albumCount: 2,
    aspectRatio: 3 / 2,
    kind: "album",
    textLines: 2,
  },
  // 1: Pure text post (4 lines of text)
  {
    kind: "text",
    textLines: 4,
  },
  // 2: Single landscape image (16:9) with 2 lines of text
  {
    aspectRatio: 16 / 9,
    kind: "image",
    textLines: 2,
  },
  // 3: Vertical / portrait image (3:4) with 1 line of text
  {
    aspectRatio: 3 / 4,
    kind: "vertical",
    textLines: 1,
  },
  // 4: Multi-image album (4 images grid) with 1 line of text
  {
    albumCount: 4,
    aspectRatio: 1,
    kind: "album",
    textLines: 1,
  },
  // 5: Text-only post (3 lines of text)
  {
    kind: "text",
    textLines: 3,
  },
  // 6: Single standard image (4:3) with 2 lines of text
  {
    aspectRatio: 4 / 3,
    kind: "image",
    textLines: 2,
  },
  // 7: Vertical / portrait image (4:5) with 2 lines of text
  {
    aspectRatio: 4 / 5,
    kind: "vertical",
    textLines: 2,
  },
] as const;

export function PostMediaSkeleton({
  post,
  profile,
}: {
  post?: PostPreviewSource | null;
  profile?: DynamicSkeletonProfile | null;
}) {
  const layout = postPreviewLayout(post);
  const effectiveKind = post ? layout.kind : (profile?.kind ?? layout.kind);
  if (["text", "unknown"].includes(effectiveKind)) {
    return null;
  }
  if (effectiveKind === "album") {
    const count =
      profile?.albumCount ?? (layout.kind === "album" ? layout.count : 2);
    const isTwo = count <= 2;
    return (
      <div
        className="mt-3 grid grid-cols-2 gap-2 transition-all duration-700 ease-in-out"
        data-skeleton-media="album"
      >
        {Array.from({ length: Math.min(count, 4) }, (_, index) => (
          <Skeleton
            className={cn(
              "rounded-xl transition-all duration-700 ease-in-out",
              isTwo ? "h-36 sm:h-44" : "h-28 sm:h-36"
            )}
            key={index}
          />
        ))}
      </div>
    );
  }
  if (effectiveKind === "audio") {
    return (
      <div
        className="mt-3 flex h-20 items-center gap-3 rounded-xl p-3"
        data-skeleton-media="audio"
      >
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-5 w-full" />
        </div>
      </div>
    );
  }
  if (effectiveKind === "vertical") {
    const ratio = profile?.aspectRatio ?? 3 / 4;
    return (
      <Skeleton
        className="mt-3 max-w-full rounded-xl transition-all duration-700 ease-in-out [--preview-max-height:360px] sm:[--preview-max-height:440px]"
        data-skeleton-media="vertical"
        style={{
          aspectRatio: ratio,
          width: `min(100%, calc(var(--preview-max-height) * ${ratio}))`,
        }}
      />
    );
  }
  const ratio = post
    ? layout.aspectRatio
    : (profile?.aspectRatio ?? (effectiveKind === "image" ? 16 / 9 : 4 / 3));
  return (
    <Skeleton
      className="mt-3 max-w-full rounded-xl transition-all duration-700 ease-in-out [--preview-max-height:320px] sm:[--preview-max-height:400px]"
      data-skeleton-media={effectiveKind}
      style={{
        aspectRatio: ratio,
        width: `min(100%, calc(var(--preview-max-height) * ${ratio}))`,
      }}
    />
  );
}

export interface PostCardSkeletonProps {
  className?: string;
  detail?: boolean;
  dynamic?: boolean;
  index?: number;
  isBluesky?: boolean;
  post?: PostPreviewSource | null;
  profile?: DynamicSkeletonProfile | null;
  source?: FeedSource;
  style?: React.CSSProperties;
}

function getLineSkeletonWidth(lineIndex: number, lineCount: number): string {
  if (lineIndex === lineCount - 1) {
    return "w-3/4";
  }
  if (lineIndex % 2 === 1) {
    return "w-11/12";
  }
  return "w-full";
}

export function PostCardSkeleton({
  className,
  detail = false,
  dynamic = true,
  index = 0,
  isBluesky,
  post,
  profile,
  source,
  style,
}: PostCardSkeletonProps) {
  const layout = postPreviewLayout(post);
  const isBsky =
    isBluesky ??
    (source === "bluesky" ||
      Boolean(post && "external" in post && post.external));

  const effectiveProfile: DynamicSkeletonProfile | undefined =
    profile ??
    (!post && dynamic
      ? DYNAMIC_SKELETON_PROFILES[index % DYNAMIC_SKELETON_PROFILES.length]
      : undefined);

  let lineCount = 2;
  if (post && typeof post.content === "string") {
    lineCount = layout.textLines;
  } else if (effectiveProfile) {
    lineCount = effectiveProfile.textLines;
  } else {
    lineCount = index % 3 === 1 ? 3 : 2;
  }

  const effectiveKind = post
    ? layout.kind
    : (effectiveProfile?.kind ?? layout.kind);

  const content = (
    <div
      className={cn(
        "space-y-2 transition-all duration-700 ease-in-out",
        detail ? "mt-3 sm:mt-3.5" : "mt-1"
      )}
    >
      {Array.from({ length: lineCount }, (_, lineIndex) => (
        <Skeleton
          className={cn(
            "h-4 transition-all duration-700 ease-in-out",
            getLineSkeletonWidth(lineIndex, lineCount)
          )}
          key={lineIndex}
        />
      ))}
      <PostMediaSkeleton post={post} profile={effectiveProfile} />
      {/* Mobile action bar: full-width space-between matching PostCard */}
      <div className="mt-3 flex w-full items-center justify-between sm:hidden">
        <Skeleton className="h-7 w-12 rounded-full" />
        <Skeleton className="h-7 w-10 rounded-full" />
        <Skeleton className="h-7 w-10 rounded-full" />
        {isBsky ? null : <Skeleton className="h-7 w-10 rounded-full" />}
        <div className="flex items-center gap-1">
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="size-7 rounded-full" />
        </div>
      </div>
      {/* Desktop action bar: left controls + right actions */}
      <div className="mt-3 hidden sm:flex sm:items-center sm:justify-between sm:gap-2">
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5">
            <Skeleton className="size-7.5 rounded-full" />
            <Skeleton className="size-7.5 rounded-full" />
            <Skeleton className="h-7.5 w-10 rounded-full" />
          </div>
          <Skeleton className="h-7.5 w-12 rounded-full" />
          <Skeleton className="h-7.5 w-12 rounded-full" />
        </div>
        <div className="flex items-center gap-1.5">
          {isBsky ? null : <Skeleton className="h-7.5 w-14 rounded-full" />}
          <Skeleton className="size-7.5 rounded-full" />
        </div>
      </div>
    </div>
  );

  return (
    <div
      aria-busy="true"
      aria-label={isBsky ? "Loading Bluesky post" : "Loading post"}
      className={cn(
        "group/post relative min-w-0 overflow-hidden rounded-none bg-[hsl(var(--background-alt))] p-4 transition-all duration-700 ease-in-out",
        className
      )}
      data-post-skeleton={effectiveKind}
      style={style}
    >
      {detail ? (
        <>
          <div className="relative flex items-start gap-2 sm:gap-3">
            <div className="shrink-0 self-start">
              <Skeleton className="avatar-ring aspect-square h-9 w-9 rounded-[30%] sm:h-12 sm:w-12" />
            </div>
            <div className="min-w-0 flex-1 pr-9 sm:pr-19">
              <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                <Skeleton className="h-4 w-28 rounded-md sm:h-5 sm:w-36" />
                {isBsky ? (
                  <BlueskyIcon
                    className="size-3.5 opacity-60 sm:size-4"
                    tooltip={false}
                  />
                ) : (
                  <Skeleton className="h-4 w-12 rounded-md sm:h-5 sm:w-15" />
                )}
                <Skeleton className="h-3.5 w-10 rounded-md sm:h-4 sm:w-14" />
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-2">
                <Skeleton
                  className={cn(
                    "h-3.5 rounded-md sm:h-4",
                    isBsky ? "w-28 sm:w-36" : "w-20 sm:w-28"
                  )}
                />
              </div>
            </div>
            <div className="absolute top-0 right-0 z-10 flex shrink-0 items-center gap-1 sm:gap-1.5">
              <Skeleton className="size-7 rounded-full sm:size-7.5" />
              <Skeleton className="hidden size-7 rounded-full sm:inline-flex sm:size-7.5" />
            </div>
          </div>
          {content}
        </>
      ) : (
        <div className="flex items-start gap-3">
          <div className="relative flex w-9 shrink-0 flex-col items-center self-stretch sm:w-10">
            <Skeleton className="avatar-ring aspect-square h-9 w-9 rounded-[30%] sm:h-10 sm:w-10" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative z-10 flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs sm:gap-2 sm:text-sm">
                <Skeleton className="h-4 w-24 rounded-md sm:w-28" />
                {isBsky ? (
                  <BlueskyIcon
                    className="size-3.5 opacity-60 sm:size-4"
                    tooltip={false}
                  />
                ) : (
                  <Skeleton className="h-4 w-10 rounded-md sm:w-12" />
                )}
                <Skeleton
                  className={cn(
                    "h-3.5 rounded-md",
                    isBsky ? "w-24 sm:w-32" : "w-16 sm:w-20"
                  )}
                />
                <span className="text-muted-foreground/40 shrink-0">·</span>
                <Skeleton className="h-3 w-6 rounded-md sm:w-8" />
              </div>
              <div className="-my-1 flex shrink-0 items-center gap-1 sm:gap-1.5">
                <Skeleton className="size-7 rounded-full sm:size-7.5" />
                <Skeleton className="hidden size-7 rounded-full sm:inline-flex sm:size-7.5" />
              </div>
            </div>
            {content}
          </div>
        </div>
      )}
    </div>
  );
}

export function BlueskyPostSkeleton(
  props: Omit<PostCardSkeletonProps, "isBluesky">
) {
  return <PostCardSkeleton {...props} isBluesky />;
}
