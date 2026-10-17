import { Button } from "@asm/ui/shadui/button";
import noMediaImage from "@assets/general/nomedia.png";
import Image from "next/image";
import type { ReactNode } from "react";

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
  return (
    <section className="space-y-4" aria-label="Eddies on ASM">
      {composer}
      {pagination}
      {empty ? <CommentsEmptyState /> : null}
      {failed ? (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <Image
            alt=""
            className="h-20 w-20 rounded-full object-contain opacity-70"
            draggable={false}
            height={80}
            src={noMediaImage}
            width={80}
          />
          <p className="text-muted-foreground text-sm">
            Eddies hit a snag. Try reloading this post.
          </p>
          {onRetry ? (
            <Button variant="ghost" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="divide-border/40 divide-y pt-1">{children}</div>
    </section>
  );
}
