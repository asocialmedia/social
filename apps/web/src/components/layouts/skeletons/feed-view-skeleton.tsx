import { Card, CardContent } from "@asm/ui/shadui/card";
import { Separator } from "@asm/ui/shadui/separator";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";

const PostCardSkeleton = () => (
  <div className="p-4">
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-1 h-3 w-24" />
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>
    </div>
    <Skeleton className="mb-2 h-4 w-20" />
    <div className="mb-4 space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>

    <Skeleton className="mb-4 h-64 w-full rounded-lg" />

    <div className="mt-2 flex items-center justify-between">
      <Skeleton className="h-8 w-24" />
      <div className="flex items-center space-x-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>
    </div>
  </div>
);

export default function FeedViewSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto bg-background p-4 pb-24">
      <Card className="mb-8 bg-card shadow-lg">
        <CardContent className="p-4">
          <Skeleton className="mb-2 h-8 w-40" />
          <Skeleton className="mb-4 h-4 w-72" />

          <div className="mb-4 flex justify-center sm:mb-6">
            <Tabs className="w-full" defaultValue="all">
              <TabsList className="grid w-full max-w-md grid-cols-4">
                <TabsTrigger
                  className="cursor-not-allowed"
                  disabled
                  value="all"
                >
                  All
                </TabsTrigger>
                <TabsTrigger
                  className="cursor-not-allowed"
                  disabled
                  value="scribbles"
                >
                  Scribbles
                </TabsTrigger>
                <TabsTrigger
                  className="cursor-not-allowed"
                  disabled
                  value="snapshots"
                >
                  Snapshots
                </TabsTrigger>
                <TabsTrigger
                  className="cursor-not-allowed"
                  disabled
                  value="reels"
                >
                  Reels
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex justify-center">
            <div className="w-full max-w-3xl space-y-2 sm:space-y-4">
              {[1, 2, 3].map((index) => (
                <div key={index}>
                  {index > 1 && <Separator className="my-2 sm:my-4" />}
                  <PostCardSkeleton />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
