"use client";

import { Button } from "@asm/ui/shadui/button";

interface GustRetrySource {
  label: string;
  hasError: boolean;
  isFetching: boolean;
  handleRetry: () => void;
}

export function GustSourceRetries({
  sources,
}: {
  sources: readonly GustRetrySource[];
}) {
  return sources
    .filter((source) => source.hasError)
    .map((source) => (
      <div className="flex h-24 items-center justify-center" key={source.label}>
        <Button disabled={source.isFetching} onClick={source.handleRetry}>
          Retry {source.label} videos
        </Button>
      </div>
    ));
}
