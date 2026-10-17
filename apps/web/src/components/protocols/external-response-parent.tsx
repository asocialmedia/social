"use client";

import { Skeleton } from "@asm/ui/shadui/skeleton";

import { ResponseParentRow } from "@/components/responses/response-parent-card";
import { externalPostView } from "@/lib/posts/presentation";

import { useExternalPost } from "./use-external-post";

export function ExternalResponseParent({ uri }: { uri: string }) {
  const query = useExternalPost(uri);
  if (query.isPending) {
    return (
      <div
        aria-label="Loading original post"
        aria-busy="true"
        className="flex gap-3 pb-3"
      >
        <Skeleton className="size-9 shrink-0 rounded-xl sm:size-10" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    );
  }
  if (query.isError && !query.data) {
    return (
      <button
        className="text-muted-foreground mb-3 text-sm hover:underline"
        onClick={() => {
          void query.refetch();
        }}
        type="button"
      >
        Couldn't load original post. Retry
      </button>
    );
  }
  const presented = query.data ? externalPostView(query.data) : null;
  const parent = presented
    ? {
        ...presented,
        user: { ...presented.user, badges: presented.user.badges ?? [] },
      }
    : null;
  return (
    <ResponseParentRow
      parent={parent}
      parentPostId={uri}
      external={query.data ?? undefined}
    />
  );
}
