"use client";

import type { ExternalPost } from "@asm/protocols/contracts";
import { Skeleton } from "@asm/ui/shadui/skeleton";

import { FeedErrorState } from "@/components/feeds/feed-error-state";
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
      <FeedErrorState
        message="Couldn't load the original Bluesky post."
        isRetrying={query.isFetching}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  return <ExternalResponseParentRow post={query.data ?? null} uri={uri} />;
}

export function ExternalResponseParentRow({
  post,
  uri,
}: {
  post: ExternalPost | null;
  uri: string;
}) {
  const presented = post ? externalPostView(post) : null;
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
      external={post ?? undefined}
    />
  );
}
