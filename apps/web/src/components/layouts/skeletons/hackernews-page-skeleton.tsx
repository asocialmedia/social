import { Separator } from "@asm/ui/shadui/separator";
import { Skeleton } from "@asm/ui/shadui/skeleton";

import { APPLE_CARD_CLASS } from "@/components/home/sidebars/right/sidebar-styles";

// Mirrors the HackerNews page: main column with mobile top bar + the
// Score/Time/Comments sort tabs (with a search + refresh), then the HN story
// feed rows; plus the right sidebar of apple cards on xl screens.
const HnStoryRowSkeleton: React.FC = () => (
  <div className="flex flex-col gap-1.5 p-3 sm:p-3.5">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded-md" />
        <Skeleton className="h-3 w-20 rounded-md" />
      </div>
      <div className="flex items-center gap-1">
        <Skeleton className="h-3 w-16 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
    </div>
    <div className="flex items-start justify-between gap-3">
      <Skeleton className="h-4 w-3/4 rounded-md" />
      <Skeleton className="h-4 w-16 shrink-0 rounded-full" />
    </div>
    <div className="mt-0.5 flex items-center gap-1.5">
      <Skeleton className="h-5 w-20 rounded-full" />
      <Skeleton className="h-5 w-16 rounded-full" />
      <Skeleton className="h-5 w-24 rounded-full" />
    </div>
    <div className="mt-0.5 flex items-center gap-1.5 pt-2">
      <Skeleton className="h-6 w-16 rounded-lg" />
      <Skeleton className="h-6 w-12 rounded-lg" />
      <Skeleton className="h-6 w-28 rounded-lg" />
      <Skeleton className="ml-auto h-6 w-14 rounded-lg" />
    </div>
  </div>
);

const SidebarCardSkeleton: React.FC = () => (
  <div className={APPLE_CARD_CLASS}>
    <div className="flex items-center gap-2 px-2 pt-0.5 pb-1">
      <Skeleton className="h-4 w-4 rounded-full" />
      <Skeleton className="h-4 w-28 rounded-md" />
    </div>
    <div className="flex flex-col gap-3 px-2 py-2">
      {[1, 2, 3].map((index) => (
        <div className="flex items-center gap-2" key={`side-${index}`}>
          <Skeleton className="h-3 w-6 rounded-md" />
          <Skeleton className="h-3 w-full rounded-md" />
        </div>
      ))}
    </div>
  </div>
);

const HackerNewsPageSkeleton: React.FC = () => (
  <div className="flex min-w-0 flex-1">
    <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
      {/* Top bar */}
      <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
        <Skeleton className="h-12 w-full rounded-none" />
        <div className="border-border/60 relative flex items-center border-b py-1.5">
          <div className="flex h-full flex-1 items-center justify-center gap-0 p-0 md:justify-start">
            {[0, 1, 2].map((index) => (
              <Skeleton className="mx-1 h-8 w-16 rounded-full" key={`tab-${index}`} />
            ))}
          </div>
          <div className="ml-auto hidden min-w-0 items-center gap-2 pr-1.5 md:flex">
            <Skeleton className="h-10 w-56 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
        </div>
      </div>

      {/* HN feed rows */}
      <div className="flex flex-col">
        {[1, 2, 3].map((index) => (
          <div key={`hn-skeleton-${index}`}>
            {index > 0 && <Separator className="bg-border/60" />}
            <HnStoryRowSkeleton />
          </div>
        ))}
      </div>
    </div>

    {/* Right sidebar */}
    <aside className="hide-native-scrollbar border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col overflow-y-auto border-l px-5 pt-2.5 pb-6 xl:flex">
      <div className="flex flex-col gap-4">
        <SidebarCardSkeleton />
        <SidebarCardSkeleton />
      </div>
    </aside>
  </div>
);

export default HackerNewsPageSkeleton;
