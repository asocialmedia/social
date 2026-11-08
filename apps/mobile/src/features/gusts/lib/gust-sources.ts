// Per-source state for the mixed reel, ported from web's client-gusts
// retrySources and gustPagingState (lib/posts/gust-feed.ts). The reel blends
// ASM and Bluesky gusts, and one failing source must not hide the other, so
// each keeps its own error and its own retry.
export type GustSourceLabel = "ASM" | "Bluesky";

export interface GustSourceState {
  enabled: boolean;
  // Any failure: a failed first load or a failed later page.
  hasError: boolean;
  hasNextPage: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  label: GustSourceLabel;
  // A failed later page, with earlier pages still loaded.
  pageError: boolean;
}

// A source plus its own retry, web's retrySources entry.
export interface GustRetrySource extends GustSourceState {
  handleRetry: () => void;
}

export function gustPagingState(sources: readonly GustSourceState[]) {
  const enabled = sources.filter((source) => source.enabled);
  return {
    canFetchNextPage: enabled.some(
      (source) => source.hasNextPage && !source.pageError
    ),
    hasNextPage: enabled.some((source) => source.hasNextPage),
    isFetchingNextPage: enabled.some((source) => source.isFetchingNextPage),
    pageError: enabled.some((source) => source.pageError),
  };
}

// The sources that get a "Retry <label> videos" action, in reel order.
export function failedGustSources<Source extends GustSourceState>(
  sources: readonly Source[]
): Source[] {
  return sources.filter((source) => source.enabled && source.hasError);
}

export function gustSourceRetryCopy(label: GustSourceLabel): {
  action: string;
  message: string;
} {
  return {
    action: `Retry ${label} videos`,
    message: `${label} videos couldn’t load right now. Please try again.`,
  };
}

// Web shows the full error panel when the reel failed and nothing can page
// on, including an empty reel whose only remaining source hit a page error.
export function showGustFeedError(input: {
  canFetchNextPage: boolean;
  pageError: boolean;
  postCount: number;
  status: "error" | "loading" | "ready";
}): boolean {
  return (
    (input.status === "error" && !input.canFetchNextPage) ||
    (input.postCount === 0 && input.pageError && !input.canFetchNextPage)
  );
}
