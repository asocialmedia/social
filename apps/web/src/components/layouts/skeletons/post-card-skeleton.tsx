import { postPreviewLayout } from "@asm/ui/lib/post-preview-layout";
import type { PostPreviewSource } from "@asm/ui/lib/post-preview-layout";
import { Skeleton } from "@asm/ui/shadui/skeleton";

import { cn } from "@/lib/utils";

export function PostMediaSkeleton({
  post,
}: {
  post?: PostPreviewSource | null;
}) {
  const layout = postPreviewLayout(post);
  if (["text", "unknown"].includes(layout.kind)) {
    return null;
  }
  if (layout.kind === "album") {
    return (
      <div className="mt-3 grid grid-cols-2 gap-2" data-skeleton-media="album">
        {Array.from({ length: Math.min(layout.count, 5) }, (_, index) => (
          <Skeleton className="h-32 rounded-xl sm:h-40" key={index} />
        ))}
      </div>
    );
  }
  if (layout.kind === "audio") {
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
  return (
    <Skeleton
      className="mt-3 max-w-full rounded-xl [--preview-max-height:380px] sm:[--preview-max-height:480px]"
      data-skeleton-media={layout.kind}
      style={{
        aspectRatio: layout.aspectRatio,
        width: `min(100%, calc(var(--preview-max-height) * ${layout.aspectRatio}))`,
      }}
    />
  );
}

export function PostCardSkeleton({
  post,
  detail = false,
}: {
  detail?: boolean;
  post?: PostPreviewSource | null;
}) {
  const layout = postPreviewLayout(post);
  return (
    <div
      aria-label="Loading post"
      aria-busy="true"
      className="min-w-0 overflow-hidden p-4"
      data-post-skeleton={layout.kind}
    >
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3.5 w-28 max-w-[45%]" />
            <Skeleton className="h-3 w-16 max-w-[25%]" />
            <Skeleton className="ml-auto size-6 shrink-0 rounded-full" />
          </div>
          {detail ? <Skeleton className="h-3 w-24" /> : null}
        </div>
      </div>
      <div className={cn("mt-3 space-y-2", !detail && "ml-12")}>
        {Array.from({ length: layout.textLines }, (_, index) => (
          <Skeleton
            className={
              index === layout.textLines - 1 ? "h-4 w-3/4" : "h-4 w-full"
            }
            key={index}
          />
        ))}
        <PostMediaSkeleton post={post} />
        <div className="mt-3 flex items-center justify-between gap-2">
          <Skeleton className="h-7 w-16 rounded-full" />
          <Skeleton className="h-7 w-12 rounded-full" />
          <Skeleton className="h-7 w-12 rounded-full" />
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="size-7 rounded-full" />
        </div>
      </div>
    </div>
  );
}
