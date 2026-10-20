"use client";

import { Button } from "@asm/ui/shadui/button";

import { FeedErrorState } from "@/components/feeds/feed-error-state";

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

export function GustFeedErrorState({
  onRetry,
  sources,
}: {
  onRetry: () => void;
  sources: readonly GustRetrySource[];
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center overflow-y-auto">
      <FeedErrorState
        message="Couldn’t load Gusts. Please try again."
        onRetry={onRetry}
      />
      <GustSourceRetries sources={sources} />
    </div>
  );
}
