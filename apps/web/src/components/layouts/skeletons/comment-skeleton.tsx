import type React from "react";

interface CommentSkeletonProps {
  showActions?: boolean;
}

const CommentSkeleton: React.FC<CommentSkeletonProps> = ({
  showActions = true,
}) => (
  <div className="group/comment flex gap-3 py-3">
    <div className="hidden sm:block">
      <div className="bg-muted h-10 w-10 animate-pulse rounded-full" />
    </div>
    <div className="flex-1">
      <div className="flex items-center gap-2 text-sm">
        <div className="bg-muted h-4 w-24 animate-pulse rounded-sm" />
        <div className="bg-muted h-4 w-16 animate-pulse rounded-sm" />
      </div>
      <div className="mt-1 space-y-2">
        <div className="bg-muted h-4 w-3/4 animate-pulse rounded-sm" />
        <div className="bg-muted h-4 w-1/2 animate-pulse rounded-sm" />
      </div>
    </div>
    {showActions ? (
      <div className="ms-auto">
        <div className="bg-muted h-8 w-8 animate-pulse rounded-md opacity-0 transition-opacity group-hover/comment:opacity-100" />
      </div>
    ) : null}
  </div>
);

export default CommentSkeleton;
