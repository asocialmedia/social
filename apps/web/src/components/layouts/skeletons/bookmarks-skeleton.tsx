import { Separator } from "@asm/ui/shadui/separator";
import { Skeleton } from "@asm/ui/shadui/skeleton";

// Mirrors the bookmarks page exactly: mobile top bar + the tab row
// (Posts / Gusts / HackerNews / Likes with count badges) + a search field,
// then the bookmarked-posts feed below it.
const BookmarkRowSkeleton: React.FC = () => (
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
);

const BookmarksSkeleton: React.FC = () => (
  <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
    {/* Top bar */}
    <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
      <Skeleton className="h-12 w-full rounded-none" />
      <div className="border-border/60 flex items-center border-b py-1.5">
        <div className="flex flex-1 items-center justify-center gap-0 p-0 md:justify-start">
          {[0, 1, 2, 3].map((index) => (
            <div
              className="mx-1 flex items-center gap-1.5"
              key={`tab-${index}`}
            >
              <Skeleton className="h-8 w-20 rounded-full" />
              <Skeleton className="h-5 w-5 rounded-full" />
            </div>
          ))}
        </div>
        <div className="ml-auto hidden w-full max-w-[24rem] pr-1.5 md:flex xl:max-w-md">
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>
    </div>

    {/* Bookmarks feed */}
    <div className="flex flex-col">
      <Separator className="bg-border/60" />
      {[1, 2, 3].map((index) => (
        <div key={`bookmark-skeleton-${index}`}>
          {index > 0 && <Separator className="bg-border/60" />}
          <BookmarkRowSkeleton />
        </div>
      ))}
    </div>
  </div>
);

export default BookmarksSkeleton;
