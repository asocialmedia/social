import { Card, CardContent } from "@asm/ui/shadui/card";
import { Skeleton } from "@asm/ui/shadui/skeleton";

import { PostCardSkeleton } from "./post-card-skeleton";

export { PostCardSkeleton } from "./post-card-skeleton";

export default function PostsOnlyLoadingSkeleton() {
  return (
    <main className="bg-background flex-1 overflow-y-auto p-6 pb-24">
      <Card className="bg-card mb-8 shadow-lg">
        <CardContent className="p-4">
          <Skeleton className="mb-2 h-8 w-48" />
          <Skeleton className="mb-4 h-4 w-full" />
          <Skeleton className="mb-6 h-10 w-full max-w-md" />
          <div className="space-y-8">
            {Array.from({ length: 3 }).map((_, index) => (
              <PostCardSkeleton key={`post-skeleton-${index}`} />
            ))}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
