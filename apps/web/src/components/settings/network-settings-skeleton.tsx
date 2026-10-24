import { Skeleton } from "@asm/ui/shadui/skeleton";

// The Network tab keeps its shape while it loads. A line of loading text
// collapses the whole pane and then snaps to a tall card once preferences
// arrive; a skeleton the same height as the real content means the reader sees
// where the settings will be instead of watching the page jump. Each variant
// mirrors the markup it stands in for: the hub lists four rows, a section shows
// its header plus a short card.

const ROW_COUNT = 4;

function HubSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 px-4 pt-6 sm:px-6">
      <div className="flex items-center gap-3 pl-[19px]">
        <Skeleton className="size-10 shrink-0 rounded-xl" />
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-5 w-24 rounded-md" />
          <Skeleton className="h-3.5 w-64 max-w-full rounded-md" />
        </div>
      </div>
      <div className="surface-3d rounded-2xl! p-1.5">
        <div className="flex flex-col gap-0.5">
          {Array.from({ length: ROW_COUNT }, (_, index) => (
            <div
              className="flex items-center gap-3 px-3 py-3"
              // The rows are placeholders, so their identity is only positional.
              key={index}
            >
              <Skeleton className="size-10 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-40 max-w-full rounded-md" />
                <Skeleton className="h-3 w-64 max-w-full rounded-md" />
                <Skeleton className="h-3 w-32 rounded-md" />
              </div>
              <Skeleton className="size-5 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 px-4 pt-6 sm:px-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-5 w-44 max-w-full rounded-md" />
            <Skeleton className="h-3.5 w-72 max-w-full rounded-md" />
          </div>
        </div>
      </div>
      <div className="surface-3d rounded-2xl! p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <Skeleton className="size-7 shrink-0 rounded-lg" />
          <div className="min-w-0 space-y-1.5">
            <Skeleton className="h-3.5 w-36 rounded-md" />
            <Skeleton className="h-3 w-56 max-w-full rounded-md" />
          </div>
        </div>
        <div className="mt-5 space-y-3">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export default function NetworkSettingsSkeleton({
  section,
}: {
  section: boolean;
}) {
  return (
    <>
      {/* One announcement for assistive tech; the shapes themselves are
          decorative and must not be read as content. */}
      <p aria-live="polite" className="sr-only">
        Loading network preferences…
      </p>
      <div aria-hidden>{section ? <SectionSkeleton /> : <HubSkeleton />}</div>
    </>
  );
}
