import { Skeleton } from "@asm/ui/shadui/skeleton";

// Mirrors the reels layout of GustCard so loading doesn't shift the page:
// a centered 9/16 video frame with the bottom-left user row + caption +
// views, the right action rail (amplify, mute, eddie, share, bookmark,
// more, video mute) and the thin seek bar at the bottom.
export const GustCardSkeleton: React.FC = () => (
  <div className="flex h-full w-full items-center justify-center">
    <div className="relative h-full w-full overflow-hidden bg-black/50 select-none sm:aspect-[9/16] sm:h-full sm:max-h-[calc(100dvh-2.5rem)] sm:w-auto sm:max-w-full sm:rounded-2xl lg:rounded-3xl">
      {/* Video frame */}
      <Skeleton className="absolute inset-0 rounded-none bg-white/5" />

      {/* Bottom scrim for text contrast */}
      <div className="absolute inset-x-0 bottom-0 h-56 bg-linear-to-t from-black/70 to-transparent" />

      {/* Bottom-left: avatar, name, username, follow, caption, views */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-3 px-4 pr-24 pb-8">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-24 bg-white/20" />
            <Skeleton className="h-3 w-16 bg-white/15" />
          </div>
          <Skeleton className="h-8 w-20 shrink-0 rounded-full bg-white/15" />
        </div>
        <div className="space-y-1.5 pr-16">
          <Skeleton className="h-3 w-3/4 bg-white/20" />
          <Skeleton className="h-3 w-1/2 bg-white/15" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="size-3.5 rounded-full bg-white/15" />
          <Skeleton className="h-3 w-14 bg-white/15" />
        </div>
      </div>

      {/* Right action rail */}
      <div className="absolute right-3 bottom-24 z-10 flex flex-col items-center gap-4">
        {Array.from({ length: 7 }).map((_, index) => (
          <div
            className="flex flex-col items-center gap-1"
            key={`rail-skeleton-${index}`}
          >
            <Skeleton className="size-11 rounded-full bg-white/10" />
            {index === 0 ? (
              <Skeleton className="h-4 w-10 rounded-md bg-white/10" />
            ) : null}
            {index === 2 ? (
              <Skeleton className="h-3 w-5 rounded-md bg-white/10" />
            ) : null}
          </div>
        ))}
      </div>

      {/* Thin seek bar at the bottom */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-1 pb-1">
        <Skeleton className="h-1 w-full rounded-full bg-white/10" />
      </div>
    </div>
  </div>
);
