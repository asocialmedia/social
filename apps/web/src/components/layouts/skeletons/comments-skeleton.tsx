import type React from "react";

// Matches the exact nested Reddit-style layout of the comments section:
// 1. Comment composer bar with avatar + rounded input.
// 2. Thread 1: Top-level comment with thread rail running down into nested replies.
// 3. Reply at depth 1: Indented with rounded rail elbow, avatar, user info, text, actions.
// 4. Thread 2: Top-level comment.
const CommentsSkeleton: React.FC = () => (
  <div className="space-y-4">
    {/* Composer Skeleton */}
    <div className="my-3 flex w-full items-start gap-2">
      <div className="bg-muted h-10 w-10 shrink-0 animate-pulse rounded-full" />
      <div className="min-w-0 flex-1">
        <div className="bg-muted/20 border-border/30 flex min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-2">
          <div className="bg-muted/50 h-4 w-40 animate-pulse rounded-md" />
          <div className="flex items-center gap-2">
            <div className="bg-muted/40 h-7 w-7 animate-pulse rounded-full" />
            <div className="bg-muted/60 h-9 w-9 animate-pulse rounded-full" />
          </div>
        </div>
      </div>
    </div>

    {/* Comment Thread List Skeleton */}
    <div className="divide-border/40 divide-y">
      {/* Thread 1: Parent with nested reply */}
      <div className="pt-2 pb-2">
        {/* Parent comment */}
        <div className="group/comment relative min-w-0 pt-1.5 pr-1 pb-1.5">
          {/* Stub down to first reply */}
          <div className="bg-border/50 pointer-events-none absolute top-6 bottom-0 left-[15px] w-[2px]" />
          <div className="flex gap-2.5">
            <div className="bg-muted relative z-10 h-9 w-9 shrink-0 animate-pulse rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <div className="bg-muted h-4 w-28 animate-pulse rounded-md" />
                <div className="bg-muted/60 h-3 w-16 animate-pulse rounded-md" />
                <div className="bg-muted/40 h-3 w-8 animate-pulse rounded-md" />
              </div>
              <div className="space-y-1.5">
                <div className="bg-muted/70 h-3.5 w-4/5 animate-pulse rounded" />
                <div className="bg-muted/50 h-3.5 w-3/5 animate-pulse rounded" />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <div className="bg-muted/40 h-6 w-14 animate-pulse rounded-full" />
                <div className="bg-muted/30 h-6 w-12 animate-pulse rounded-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Nested reply 1 */}
        <div className="relative pl-8">
          {/* Curved SVG rail connector */}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0 overflow-visible"
            style={{ height: 28, width: 36 }}
          >
            <path
              d="M 16 -1 V 8 A 16 16 0 0 0 32 24 H 34"
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth="2"
            />
          </svg>
          <div className="group/comment relative min-w-0 pt-1.5 pr-1 pb-1.5">
            <div className="flex gap-2.5">
              <div className="bg-muted relative z-10 h-9 w-9 shrink-0 animate-pulse rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="bg-muted h-4 w-24 animate-pulse rounded-md" />
                  <div className="bg-muted/60 h-3 w-14 animate-pulse rounded-md" />
                  <div className="bg-muted/40 h-3 w-8 animate-pulse rounded-md" />
                </div>
                <div className="space-y-1.5">
                  <div className="bg-muted/70 h-3.5 w-3/4 animate-pulse rounded" />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <div className="bg-muted/40 h-6 w-14 animate-pulse rounded-full" />
                  <div className="bg-muted/30 h-6 w-12 animate-pulse rounded-full" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Thread 2: Single top-level comment */}
      <div className="pt-2 pb-2">
        <div className="group/comment relative min-w-0 pt-1.5 pr-1 pb-1.5">
          <div className="flex gap-2.5">
            <div className="bg-muted relative z-10 h-9 w-9 shrink-0 animate-pulse rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <div className="bg-muted h-4 w-32 animate-pulse rounded-md" />
                <div className="bg-muted/60 h-3 w-20 animate-pulse rounded-md" />
                <div className="bg-muted/40 h-3 w-8 animate-pulse rounded-md" />
              </div>
              <div className="space-y-1.5">
                <div className="bg-muted/70 h-3.5 w-11/12 animate-pulse rounded" />
                <div className="bg-muted/50 h-3.5 w-1/2 animate-pulse rounded" />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <div className="bg-muted/40 h-6 w-14 animate-pulse rounded-full" />
                <div className="bg-muted/30 h-6 w-12 animate-pulse rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default CommentsSkeleton;
