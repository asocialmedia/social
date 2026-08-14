import { Card } from "@asm/ui/shadui/card";
import { Skeleton } from "@asm/ui/shadui/skeleton";

export default function LoadMoreSkeleton() {
  return (
    <Card className="bg-card/50 mx-auto my-4 w-full max-w-3xl">
      <div className="p-4">
        <div className="flex items-center space-x-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </div>
    </Card>
  );
}
