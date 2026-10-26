import { Skeleton } from "@asm/ui/shadui/skeleton";

export function ProfileUserListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading people">
      {Array.from({ length: 7 }, (_, index) => (
        <div
          key={index}
          className="border-border/60 flex items-center gap-3 border-b px-4 py-3"
        >
          <Skeleton className="size-11 shrink-0 rounded-[30%]" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-32 max-w-full" />
            <Skeleton className="h-3 w-24 max-w-full" />
          </div>
          <Skeleton className="h-8 w-20 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function FollowersPageSkeleton() {
  return (
    <>
      <div
        aria-busy="true"
        aria-label="Loading followers and following"
        className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col overflow-hidden bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl"
      >
        <div className="shrink-0 pt-2">
          <div className="border-border/60 flex h-14 items-center border-b px-3 md:hidden">
            <Skeleton className="size-8 rounded-full" />
          </div>
          <div className="border-border/60 flex h-[57px] items-center justify-center gap-6 border-b">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-20" />
          </div>
          <div className="px-4 py-3">
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden pb-24">
          <ProfileUserListSkeleton />
        </div>
      </div>
      <aside
        aria-hidden="true"
        className="hidden h-screen w-80 shrink-0 flex-col gap-3 border-l border-[hsl(var(--border))] bg-[hsl(var(--background-alt))] p-3 lg:flex"
      >
        <Skeleton className="h-52 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </aside>
    </>
  );
}
