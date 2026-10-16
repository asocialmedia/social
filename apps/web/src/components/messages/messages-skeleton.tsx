import { Skeleton } from "@asm/ui/shadui/skeleton";

import { cn } from "@/lib/utils";

export function ConversationListSkeleton({
  full = false,
}: { full?: boolean } = {}) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading conversations"
      className={
        full
          ? "flex flex-col gap-1 p-2"
          : "flex flex-col items-center gap-2 p-2"
      }
    >
      {[0, 1, 2, 3, 4, 5, 6].map((index) => (
        <div
          className={
            full ? "flex items-center gap-3 rounded-2xl px-2.5 py-3" : ""
          }
          key={index}
        >
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          {full ? (
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Skeleton
                  className={index % 2 ? "h-3.5 w-1/2" : "h-3.5 w-2/5"}
                />
                <Skeleton className="h-2.5 w-8" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Skeleton className={index % 2 ? "h-3 w-3/4" : "h-3 w-3/5"} />
                {index % 3 === 0 ? (
                  <Skeleton className="size-4 shrink-0 rounded-full" />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function MessageThreadSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading conversation"
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <div className="border-border/60 flex h-14 shrink-0 items-center gap-3 border-b px-3">
        <Skeleton className="size-8 shrink-0 rounded-full md:hidden" />
        <Skeleton className="size-8 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-28 max-w-full" />
          <Skeleton className="h-3 w-20 max-w-full" />
        </div>
        <Skeleton className="size-8 shrink-0 rounded-full" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden p-4">
        <Skeleton className="mx-auto mb-3 h-5 w-16 shrink-0 rounded-full" />
        {[0, 1, 2, 3, 4].map((index) => (
          <div
            className={cn("flex", index % 2 ? "justify-end" : "justify-start")}
            key={index}
          >
            <div
              className={cn(
                "max-w-[78%] space-y-1",
                index % 2 ? "w-44" : "w-60"
              )}
            >
              <Skeleton
                className={cn(
                  "w-full rounded-2xl",
                  index === 2 ? "h-20" : "h-11",
                  index % 2 ? "rounded-br-md" : "rounded-bl-md"
                )}
              />
              <Skeleton className={cn("h-2 w-8", index % 2 && "ml-auto")} />
            </div>
          </div>
        ))}
      </div>
      <div
        className="border-border/60 flex shrink-0 items-center gap-2 border-t px-3 py-3"
        data-skeleton-composer
      >
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <Skeleton className="h-10 min-w-0 flex-1 rounded-2xl" />
        <Skeleton className="size-10 shrink-0 rounded-full" />
      </div>
    </div>
  );
}

export function ActiveFriendsRailSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {[0, 1, 2, 3].map((index) => (
        <div className="flex items-center gap-3" key={index}>
          <Skeleton className="size-9 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MessagesSkeleton({
  conversationOpen = false,
}: { conversationOpen?: boolean } = {}) {
  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden"
      data-messages-skeleton={conversationOpen ? "thread" : "list"}
    >
      <div
        className={cn(
          "border-border/60 min-h-0 shrink-0 flex-col overflow-hidden border-r md:flex md:w-72 xl:w-80",
          conversationOpen ? "hidden" : "flex w-full"
        )}
      >
        <div className="border-border/60 flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
          <Skeleton className="h-5 w-24" />
          <div className="flex gap-2">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="size-8 rounded-full" />
          </div>
        </div>
        <div className="space-y-3 px-3 py-3">
          <Skeleton className="h-9 w-full rounded-xl" />
          <div className="flex gap-2">
            {[0, 1, 2].map((index) => (
              <Skeleton className="h-7 w-20 rounded-full" key={index} />
            ))}
          </div>
        </div>
        <ConversationListSkeleton full />
      </div>
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 md:flex",
          conversationOpen ? "flex" : "hidden"
        )}
      >
        <MessageThreadSkeleton />
      </div>
      <div className="border-border/60 hidden w-64 shrink-0 flex-col border-l lg:flex">
        <div className="border-border/60 flex h-14 items-center border-b px-4">
          <Skeleton className="h-4 w-24" />
        </div>
        <ActiveFriendsRailSkeleton />
      </div>
    </div>
  );
}
