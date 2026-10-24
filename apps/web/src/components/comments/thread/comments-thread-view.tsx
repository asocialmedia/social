import type { ReactNode } from "react";

import { FeedErrorState } from "@/components/feeds/feed-error-state";
import CommentsSkeleton from "@/components/layouts/skeletons/comments-skeleton";

import { CommentsEmptyState } from "./comments-empty-state";

export function CommentsThreadView({
  loading,
  failed,
  empty,
  composer,
  pagination,
  children,
  onRetry,
}: {
  loading: boolean;
  failed: boolean;
  empty: boolean;
  composer: ReactNode;
  pagination?: ReactNode;
  children: ReactNode;
  onRetry?: () => void;
}) {
  if (loading) {
    return <CommentsSkeleton />;
  }
  let errorState = null;
  if (failed) {
    errorState = onRetry ? (
      <FeedErrorState
        message="Couldn't load eddies. Please try again."
        onRetry={onRetry}
      />
    ) : (
      <p
        role="alert"
        className="text-muted-foreground py-8 text-center text-sm"
      >
        Couldn't load eddies. Please reload this post.
      </p>
    );
  }
  return (
    <section className="space-y-4" aria-label="Eddies on asocialmedia">
      {composer}
      {pagination}
      {empty ? <CommentsEmptyState /> : null}
      {errorState}
      <div className="divide-border/40 divide-y pt-1">{children}</div>
    </section>
  );
}
