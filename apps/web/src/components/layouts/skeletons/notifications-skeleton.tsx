import { Separator } from "@asm/ui/shadui/separator";
import { Skeleton } from "@asm/ui/shadui/skeleton";

// Mirrors the notifications page's main column: mobile top bar + the
// All / Mentions tab row, then the notification feed rows below it.
const NotificationSkeletonRow: React.FC = () => (
  <div className="flex items-start gap-3 px-4 py-3">
    <div className="relative shrink-0">
      <Skeleton className="h-10 w-10 rounded-xl" />
      <Skeleton className="absolute -right-1 -bottom-1 h-5 w-5 rounded-full" />
    </div>
    <div className="min-w-0 flex-1 pt-0.5">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-28 rounded-md" />
        <Skeleton className="h-4 w-20 rounded-md" />
      </div>
      <Skeleton className="mt-2 h-3.5 w-3/4 rounded-md" />
      <Skeleton className="mt-1.5 h-3 w-16 rounded-md" />
    </div>
  </div>
);

const NotificationsSkeleton: React.FC = () => (
  // Same column wrapper as the real page so the skeleton stays centered at
  // max-w-5xl instead of stretching full width. Top bar, then the notification
  // feed rows.
  <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
        <Skeleton className="h-12 w-full rounded-none" />
        <div className="border-border/60 flex items-center border-b">
          <Skeleton className="h-9 flex-1 rounded-none" />
          <Skeleton className="h-9 flex-1 rounded-none" />
        </div>
      </div>

      <div className="flex flex-col">
        {[1, 2, 3, 4, 5].map((index) => (
          <div key={`notif-skeleton-${index}`}>
            {index > 0 && <Separator className="bg-border/60" />}
            <NotificationSkeletonRow />
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default NotificationsSkeleton;
