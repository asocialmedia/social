import { Skeleton } from "@asm/ui/shadui/skeleton";

export default function CommunityChatLoading() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading community chat"
      className="flex min-h-[70dvh] flex-1 flex-col"
    >
      <output className="sr-only">Loading community chat…</output>
      <div
        aria-hidden="true"
        className="border-border/60 flex items-center gap-3 border-b p-4"
      >
        <Skeleton className="size-10 rounded-xl" />
        <Skeleton className="h-5 w-40" />
      </div>
      <CommunityChatTranscriptSkeleton />
      <Skeleton
        aria-hidden="true"
        className="mx-4 mb-4 h-14 shrink-0 rounded-2xl"
      />
    </section>
  );
}

export function CommunityChatTranscriptSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading messages"
      className="flex flex-1 flex-col justify-end gap-6 p-4"
    >
      {["first", "second", "third"].map((key) => (
        <div aria-hidden="true" className="flex gap-3" key={key}>
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="grid w-full max-w-md gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
