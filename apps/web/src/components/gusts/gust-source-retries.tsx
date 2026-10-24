"use client";

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
      <FeedErrorState
        compact
        key={source.label}
        message={`${source.label} videos couldn’t load right now. Please try again.`}
        isRetrying={source.isFetching}
        onRetry={source.handleRetry}
        retryLabel={`Retry ${source.label} videos`}
      />
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
