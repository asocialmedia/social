import { Skeleton } from "@asm/ui/shadui/skeleton";

// Mirrors the profile page exactly: banner + avatar + identity + stats header,
// then the sticky tab bar, then the posts feed below it. Runs as the Suspense
// fallback for /users/[username] so the first paint reads as "a profile loading"
// rather than a bare feed.
export default function ProfileSkeleton() {
  return (
    <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
      <div className="border-border/60 border-b">
        {/* Banner */}
        <div className="bg-muted/20 relative h-32 sm:h-44">
          <Skeleton className="absolute inset-0 rounded-none" />
          <div className="absolute inset-0 bg-linear-to-t from-[hsl(var(--background-alt))] to-transparent" />
        </div>

        <div className="px-4">
          {/* Avatar + action buttons */}
          <div className="flex items-end justify-between">
            <Skeleton className="ring-background relative -mt-14 size-28 rounded-xl ring-4 sm:-mt-16" />
            <div className="mb-2 flex gap-2">
              <Skeleton className="h-9 w-24 rounded-full" />
              <Skeleton className="h-9 w-24 rounded-full" />
            </div>
          </div>

          {/* Identity */}
          <div className="mt-3 space-y-1.5">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>

          {/* Bio */}
          <div className="mt-3 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>

          {/* Joined */}
          <Skeleton className="mt-3 h-4 w-36" />

          {/* Stats row */}
          <div className="mt-2.5 flex items-center gap-4 pb-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      </div>

      {/* Sticky tab bar */}
      <div className="border-border/60 sticky top-0 z-10 flex items-center justify-center border-b bg-[hsl(var(--background-alt))]/95 py-1.5 backdrop-blur-md">
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4].map((index) => (
            <Skeleton className="h-8 w-16 rounded-full" key={`tab-${index}`} />
          ))}
        </div>
      </div>

      {/* Posts feed */}
      <div className="p-4">
        <div className="flex gap-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 pr-16">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-3 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="mt-2.5 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <Skeleton className="mt-2.5 h-56 w-full rounded-lg" />
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <Skeleton className="h-8 w-16 rounded-full" />
                <Skeleton className="h-8 w-16 rounded-full" />
                <Skeleton className="h-8 w-16 rounded-full" />
              </div>
              <div className="flex items-center gap-1">
                <Skeleton className="h-8 w-14 rounded-full" />
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-8 w-8 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
