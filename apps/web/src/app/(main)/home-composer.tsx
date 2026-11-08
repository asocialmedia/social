"use client";

import { Skeleton } from "@asm/ui/shadui/skeleton";
import { lazy, Suspense } from "react";

const PostEditor = lazy(() => import("@/components/posts/editor/post-editor"));

export default function HomeComposer() {
  return (
    <Suspense
      fallback={
        <section
          aria-label="Loading composer"
          aria-busy="true"
          className="border-border flex gap-5 border-y bg-[hsl(var(--background-alt))] p-5"
        >
          <Skeleton className="size-12 shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-12 w-full rounded-2xl" />
            <div className="mt-3 flex h-9 items-center justify-between">
              <Skeleton className="h-8 w-32 rounded-xl" />
              <Skeleton className="h-8 w-48 rounded-xl" />
            </div>
          </div>
        </section>
      }
    >
      <PostEditor />
    </Suspense>
  );
}
