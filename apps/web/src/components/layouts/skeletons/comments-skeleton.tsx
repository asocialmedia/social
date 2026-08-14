import CommentSkeleton from "./comment-skeleton";

const CommentsSkeleton = () => (
  <div className="mt-4 space-y-3">
    <div className="border-border rounded-lg border p-4">
      <div className="flex gap-3">
        <div className="bg-muted h-10 w-10 animate-pulse rounded-full" />
        <div className="flex-1">
          <div className="bg-muted h-24 animate-pulse rounded-md" />
          <div className="mt-3 flex justify-between">
            <div className="bg-muted h-4 w-24 animate-pulse rounded-sm" />
            <div className="bg-muted h-9 w-20 animate-pulse rounded-md" />
          </div>
        </div>
      </div>
    </div>

    <div className="flex justify-center">
      <div className="bg-muted h-9 w-32 animate-pulse rounded-md" />
    </div>

    <div className="divide-y">
      {["comment-1", "comment-2", "comment-3"].map((id) => (
        <CommentSkeleton key={id} />
      ))}
    </div>
  </div>
);

export default CommentsSkeleton;
