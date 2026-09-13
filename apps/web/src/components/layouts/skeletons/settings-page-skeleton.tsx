import { Skeleton } from "@asm/ui/shadui/skeleton";

function SettingsCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`border-border/60 rounded-2xl border bg-[hsl(var(--background))] p-5 sm:p-6 ${className ?? ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-4 w-36 max-w-full rounded-md" />
            <Skeleton className="h-3 w-56 max-w-full rounded-md" />
          </div>
        </div>
        <Skeleton className="h-8 w-24 shrink-0 rounded-full" />
      </div>
      <div className="mt-5 space-y-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-4/5 rounded-xl" />
      </div>
    </div>
  );
}

function SettingsSidebarSkeleton() {
  return (
    <aside
      aria-hidden
      className="bg-background border-border/60 sticky top-0 hidden h-screen w-72 shrink-0 flex-col gap-4 overflow-hidden border-l px-2.5 pt-2.5 pb-6 xl:flex"
    >
      <div className="border-border/60 rounded-2xl border p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-28 rounded-md" />
            <Skeleton className="h-3 w-20 rounded-md" />
          </div>
        </div>
        <div className="border-border/60 mt-4 grid grid-cols-3 gap-3 border-t pt-3">
          {["following", "followers", "aura"].map((stat) => (
            <div className="space-y-1.5" key={stat}>
              <Skeleton className="h-3.5 w-8 rounded-md" />
              <Skeleton className="h-2.5 w-11 rounded-md" />
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-12 w-4/5 rounded-md" />
    </aside>
  );
}

// Mirrors the settings center column and desktop account rail. The fallback is
// deliberately full-width so loading does not collapse into a feed-shaped card.
export default function SettingsPageSkeleton() {
  return (
    <>
      <div
        aria-hidden
        className="border-border/60 mx-auto flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:max-w-5xl"
      >
        <div className="z-20 shrink-0 bg-[hsl(var(--background-alt))]/90 pt-2 backdrop-blur-md">
          <div className="flex items-center gap-3 px-3 pb-2 md:hidden">
            <Skeleton className="size-9 rounded-xl" />
            <Skeleton className="h-8 flex-1 rounded-xl" />
          </div>
          <div className="border-border/60 flex items-center gap-3 border-y px-3 py-2">
            <div className="flex flex-1 items-center gap-2">
              <Skeleton className="h-8 w-16 rounded-full" />
              <Skeleton className="h-8 w-18 rounded-full" />
              <Skeleton className="h-8 w-18 rounded-full" />
            </div>
            <Skeleton className="hidden h-9 w-60 rounded-xl md:block" />
          </div>
          <div className="border-border/60 px-3 py-2 md:hidden">
            <Skeleton className="h-9 w-full rounded-xl" />
          </div>
        </div>

        <div className="hide-native-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-6 px-4 py-6 sm:px-6">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 shrink-0 rounded-xl" />
              <div className="min-w-0 space-y-2">
                <Skeleton className="h-5 w-28 rounded-md" />
                <Skeleton className="h-3.5 w-72 max-w-full rounded-md" />
              </div>
            </div>
            <SettingsCardSkeleton />
            <SettingsCardSkeleton />
            <SettingsCardSkeleton className="min-h-56" />
          </div>
        </div>
      </div>
      <SettingsSidebarSkeleton />
    </>
  );
}
