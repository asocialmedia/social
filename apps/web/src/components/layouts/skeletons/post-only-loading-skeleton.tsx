import { Card, CardContent } from "@asm/ui/shadui/card";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import type React from "react";

const PostCardSkeleton: React.FC = () => (
  <Card className="border-border bg-background border-t border-b">
    <CardContent className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-1 h-3 w-20" />
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-8" />
        </div>
      </div>
      <Skeleton className="mb-2 h-6 w-16" />
      <Skeleton className="mb-4 h-4 w-full" />
      <Skeleton className="mb-4 h-40 w-full" />
      <div className="flex items-center space-x-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
      </div>
    </CardContent>
  </Card>
);

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
