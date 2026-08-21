import { Skeleton } from "@asm/ui/shadui/skeleton";

import { APPLE_CARD_CLASS } from "@/components/home/sidebars/right/sidebar-styles";

// Page-level fallback for /discover. Mirrors the full explore page: the mobile
// top bar + For you / Trending / Gusts tab row (with search), then the scroll
// body (Trending Gusts rail + masonry of post/user cards), plus the right
// sidebar on xl screens.
const ASPECTS = [4 / 5, 3 / 4, 1, 4 / 5, 3 / 4, 1, 4 / 5, 3 / 4, 1, 4 / 5];

const GustRailSkeleton: React.FC = () => (
  <section className="sidebar-subcard mb-6 overflow-hidden rounded-2xl">
    <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <Skeleton className="size-4.5 rounded-full" />
        <Skeleton className="h-4 w-28 rounded-md" />
      </div>
      <Skeleton className="h-4 w-16 rounded-md" />
    </div>
    <div className="flex gap-3 overflow-hidden px-4 pb-4">
      {[0, 1, 2, 3].map((index) => (
        <div className="w-28 shrink-0 sm:w-36" key={`gust-rail-${index}`}>
          <Skeleton className="aspect-[9/16] w-full rounded-2xl" />
        </div>
      ))}
    </div>
  </section>
);

const PostSkeleton: React.FC<{ aspect: number }> = ({ aspect }) => (
  <div className="sidebar-subcard mb-4 break-inside-avoid overflow-hidden rounded-2xl">
    <div className="bg-muted/20 relative w-full overflow-hidden">
      <Skeleton
        className="w-full rounded-none"
        style={{ aspectRatio: aspect }}
      />
    </div>
    <div className="flex flex-col gap-2.5 p-3">
      <Skeleton className="h-3.5 w-full rounded-md" />
      <Skeleton className="h-3.5 w-3/4 rounded-md" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-3 w-24 rounded-md" />
          <Skeleton className="mt-1 h-2.5 w-16 rounded-md" />
        </div>
      </div>
    </div>
    <div className="flex items-center gap-2 px-3 pb-3">
      <Skeleton className="h-8 w-20 rounded-full" />
    </div>
  </div>
);

const UserSkeleton: React.FC = () => (
  <div className="sidebar-subcard mb-4 break-inside-avoid overflow-hidden rounded-2xl">
    <Skeleton className="h-20 w-full rounded-none" />
    <div className="p-3">
      <Skeleton className="-mt-9 h-11 w-11 rounded-xl" />
      <div className="mt-2 space-y-1.5">
        <Skeleton className="h-4 w-2/3 rounded-md" />
        <Skeleton className="h-3 w-1/2 rounded-md" />
      </div>
      <Skeleton className="mt-2 h-3.5 w-full rounded-md" />
      <div className="mt-2 flex items-center gap-3">
        <Skeleton className="h-3 w-14 rounded-md" />
        <Skeleton className="h-3 w-12 rounded-md" />
      </div>
      <Skeleton className="mt-3 h-8 w-full rounded-full" />
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

const ExplorePageSkeleton: React.FC = () => (
  <div className="flex min-w-0 flex-1">
    <div className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl">
      {/* Top bar + tabs */}
      <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
        <Skeleton className="h-12 w-full rounded-none" />
        <div className="border-border/60 flex items-center gap-2 border-b px-3 py-1.5">
          <div className="flex flex-1 items-center justify-center gap-0 p-0 md:justify-start">
            {[0, 1, 2].map((index) => (
              <Skeleton
                className="mx-1 h-8 w-20 rounded-full"
                key={`tab-${index}`}
              />
            ))}
          </div>
          <div className="relative ml-auto hidden min-w-0 items-center gap-2 md:flex">
            <Skeleton className="h-10 w-60 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Scroll body */}
      <div className="p-4">
        <GustRailSkeleton />
        <div className="columns-2 gap-4 sm:columns-3 xl:columns-4">
          {ASPECTS.map((aspect, index) =>
            index === 4 || index === 9 ? (
              <UserSkeleton key={`explore-skel-${index}`} />
            ) : (
              <PostSkeleton aspect={aspect} key={`explore-skel-${index}`} />
            )
          )}
        </div>
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

export default ExplorePageSkeleton;
