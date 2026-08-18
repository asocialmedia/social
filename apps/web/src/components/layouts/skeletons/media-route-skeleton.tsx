import { Skeleton } from "@asm/ui/shadui/skeleton";

// Fullscreen media-route placeholder. /posts/[id]/media/[index] opens the
// viewer over the post page, so this Suspense fallback must read as "the media
// screen" from the first paint (a black canvas with a centered media-shaped
// skeleton + a header) instead of flashing a post-page skeleton first.
export default function MediaRouteSkeleton() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Mobile header */}
      <div className="flex shrink-0 items-center justify-between bg-linear-to-b from-black/80 to-transparent px-3 pt-3 pb-5">
        <Skeleton className="h-9 w-9 rounded-full bg-white/15" />
        <div className="ml-3 flex items-center gap-2.5">
          <Skeleton className="h-10 w-10 rounded-full bg-white/15" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-28 bg-white/15" />
            <Skeleton className="h-3 w-20 bg-white/10" />
          </div>
        </div>
      </div>

      {/* Centered media area */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4">
        <div className="relative h-full max-h-[78vh] w-full max-w-5xl animate-pulse overflow-hidden rounded-xl bg-white/10">
          <div className="absolute inset-0 flex items-center justify-center">
            <Skeleton className="h-14 w-14 rounded-2xl bg-white/15" />
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-16 rounded-full bg-white/15" />
          <Skeleton className="h-8 w-8 rounded-full bg-white/10" />
          <Skeleton className="h-8 w-8 rounded-full bg-white/10" />
        </div>
      </div>
    </div>
  );
}
