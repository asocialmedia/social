import { Skeleton } from "@asm/ui/shadui/skeleton";

import { cn } from "@/lib/utils";

// Skeleton for the conversation list.
export function ConversationListSkeleton() {
  return (
    <div className="flex flex-col gap-1 p-2">
      {[1, 2, 3, 4, 5, 6].map((index) => (
        <div
          className="flex items-center gap-3 rounded-2xl p-2.5"
          key={`convo-skeleton-${index}`}
        >
          <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-28 rounded-md" />
            <Skeleton className="h-3 w-16 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Skeleton for the thread pane (header + message bubbles).
export function MessageThreadSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="border-border/60 flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-32 rounded-md" />
          <Skeleton className="h-3 w-20 rounded-md" />
        </div>
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      </div>
      <div className="flex flex-1 flex-col justify-end gap-2.5 p-4">
        {[1, 2, 3, 4].map((index) => {
          const mine = index % 2 === 0;
          return (
            <div
              className={cn("flex", mine ? "justify-end" : "justify-start")}
              key={`bubble-skeleton-${index}`}
            >
              <Skeleton
                className={cn(
                  "h-10 rounded-2xl",
                  mine ? "w-52 rounded-br-md" : "w-64 rounded-bl-md"
                )}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Skeleton rows for the active-friends rail (right column).
export function ActiveFriendsRailSkeleton() {
  return (
    <div className="flex flex-col gap-0.5 p-4">
      {[1, 2, 3, 4].map((index) => (
        <div
          className="flex items-center gap-2.5 rounded-xl px-2 py-2"
          key={`rail-skeleton-${index}`}
        >
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-3/4 rounded-md" />
            <Skeleton className="h-3 w-1/2 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Full three-pane skeleton shown while the messages identity bootstraps.
export function MessagesSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-row overflow-hidden">
      <div className="flex w-16 shrink-0 flex-col border-r border-[hsl(var(--border))]">
        <div className="border-border/60 flex h-14 shrink-0 items-center justify-center border-b">
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
        <ConversationListSkeleton />
      </div>

      <div className="flex min-w-0 flex-1 flex-col border-r border-[hsl(var(--border))]">
        <MessageThreadSkeleton />
      </div>

      <div className="hidden w-64 shrink-0 flex-col border-l border-[hsl(var(--border))] lg:flex">
        <div className="border-border/60 flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-3.5 w-14 rounded-md" />
          <Skeleton className="ml-auto h-3 w-6 rounded-md" />
        </div>
        <ActiveFriendsRailSkeleton />
      </div>
    </div>
  );
}
