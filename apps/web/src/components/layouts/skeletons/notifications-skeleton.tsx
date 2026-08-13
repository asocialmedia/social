import { Skeleton } from "@asm/ui/shadui/skeleton";

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
  <div className="flex flex-col">
    {[1, 2, 3, 4, 5].map((index) => (
      <NotificationSkeletonRow key={`notif-skeleton-${index}`} />
    ))}
  </div>
);

export default NotificationsSkeleton;
