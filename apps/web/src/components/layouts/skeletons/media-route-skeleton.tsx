import { Skeleton } from "@asm/ui/shadui/skeleton";

import { PostCardSkeleton } from "./post-only-loading-skeleton";

// Fullscreen media-route placeholder. /posts/[id]/media/[index] opens the
// viewer as a standalone fullscreen screen (media stage on the left, post
// details in a right aside on desktop, action bar along the bottom). The
// skeleton mirrors that exact layout so the first paint reads as "the media
// screen" rather than a flash of the post page or a tiny box on the left.
export default function MediaRouteSkeleton() {
  return (
    <div className="fixed inset-0 flex h-dvh w-full overflow-hidden overscroll-none bg-black">
      {/* Media column */}
      <div className="relative flex h-full min-w-0 flex-1 flex-col bg-black">
        {/* Mobile header (hidden on desktop, mirroring the real viewer) */}
        <div className="flex shrink-0 items-center justify-between bg-linear-to-b from-black/80 to-transparent px-3 pt-3 pb-5 lg:hidden">
          <Skeleton className="h-9 w-9 rounded-full bg-white/15" />
          <div className="ml-3 flex items-center gap-2.5">
            <Skeleton className="h-10 w-10 rounded-full bg-white/15" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28 bg-white/15" />
              <Skeleton className="h-3 w-20 bg-white/10" />
            </div>
          </div>
        </div>

        {/* Full-bleed media stage */}
        <div className="relative flex h-full min-h-0 flex-1 items-center justify-center overflow-hidden">
          {/* Media-shaped frame, centered and filling most of the stage instead
              of a tiny box hugging the left edge */}
          <div className="flex h-full w-full max-w-5xl items-center justify-center p-4 sm:p-8">
            <Skeleton className="h-full max-h-[82vh] w-full animate-pulse rounded-xl bg-white/10" />
          </div>

          {/* Prev / next placeholder buttons */}
          <Skeleton className="absolute top-1/2 left-3 z-50 hidden h-11 w-11 -translate-y-1/2 rounded-full bg-white/10 lg:block" />
          <Skeleton className="absolute top-1/2 right-3 z-50 hidden h-11 w-11 -translate-y-1/2 rounded-full bg-white/10 lg:block" />

          {/* Desktop close button */}
          <Skeleton className="absolute top-4 left-3 z-50 hidden h-11 w-11 rounded-full bg-white/10 lg:block" />
        </div>

        {/* Action bar (mobile only, hidden on desktop) */}
        <div className="flex shrink-0 items-center justify-between px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-full bg-white/15" />
            <Skeleton className="h-9 w-9 rounded-full bg-white/10" />
            <Skeleton className="h-9 w-9 rounded-full bg-white/10" />
          </div>
          <Skeleton className="h-4 w-16 bg-white/10" />
        </div>
      </div>

      {/* Desktop post-details aside: reuses the real post card skeleton so the
          loading state matches the post content that renders once it loads */}
      <aside className="hidden h-full w-95 flex-col border-l border-white/10 bg-[hsl(var(--background))] lg:flex">
        <div className="flex-1 overflow-y-auto">
          <PostCardSkeleton />
        </div>
      </aside>
    </div>
  );
}
