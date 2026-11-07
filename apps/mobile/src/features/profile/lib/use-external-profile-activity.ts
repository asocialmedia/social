import { useSessionContext } from "@/features/auth/state/session";
import { useNetworkSettings } from "@/features/network/state/use-network-settings";
import { useProtocolPages } from "@/features/network/state/use-protocol-pages";

import { readExternalProfileActivity } from "./external-activity-api";
import type {
  ExternalProfileActivityItem,
  ExternalProfileActivityKind,
  ExternalProfileActivityPage,
  ProfileActivityCursor,
} from "./profile-activity-schema";

export interface ExternalProfileActivity {
  // Timestamp of the last loaded page's cursor, the merge boundary.
  boundary: string | null;
  // True once the first page has landed, even an empty one, matching web `data`.
  hasData: boolean;
  hasNextPage: boolean;
  isError: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  items: ExternalProfileActivityItem[];
  loading: boolean;
  networkError: boolean;
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<void>;
  refresh: () => Promise<void>;
  retryNetworkSettings: () => Promise<void>;
}

// Mirrors web's useExternalProfileActivity: Bluesky amplifications or eddies
// for an ASM profile, signed-in only, and held until the viewer's Network
// settings have loaded so content filters apply to the first page. `kind`
// null switches it off for tabs that carry no Bluesky activity.
export function useExternalProfileActivity(
  userId: string | null,
  kind: ExternalProfileActivityKind | null
): ExternalProfileActivity {
  const { user } = useSessionContext();
  const network = useNetworkSettings();
  const signedIn = Boolean(user);
  const active = signedIn && Boolean(userId) && kind !== null;
  const enabled = active && network.ready;
  // Each "item" is a whole page, so the last page's cursor (the merge
  // boundary) stays readable; the rows are flattened below.
  const pages = useProtocolPages<
    ExternalProfileActivityPage,
    ProfileActivityCursor
  >(
    [
      "profile-external-activity",
      userId ?? "none",
      kind ?? "none",
      user?.id ?? "guest",
      network.scope,
    ].join(":"),
    async (cursor, signal) => {
      if (!userId || !kind) {
        return { cursor: null, items: [] };
      }
      const page = await readExternalProfileActivity(
        userId,
        kind,
        cursor,
        signal
      );
      return { cursor: page.nextCursor, items: [page] };
    },
    enabled
  );
  const networkError = active && !network.ready && Boolean(network.error);
  const hasData = pages.data !== undefined;
  const firstPagePending = !hasData && !pages.error;
  const { fetchNext, hasMore, refresh } = pages;
  // A failed later page retries that page; a failed first page starts over.
  const refetch = () => (pages.data && hasMore ? fetchNext() : refresh());
  if (!active) {
    return {
      boundary: null,
      fetchNextPage: () => Promise.resolve(),
      hasData: false,
      hasNextPage: false,
      isError: false,
      isFetching: false,
      isFetchingNextPage: false,
      items: [],
      loading: false,
      networkError: false,
      refetch: () => Promise.resolve(),
      refresh: () => Promise.resolve(),
      retryNetworkSettings: network.refetch,
    };
  }
  return {
    boundary: pages.items.at(-1)?.nextCursor?.at ?? null,
    fetchNextPage: fetchNext,
    hasData,
    hasNextPage: hasMore,
    isError: Boolean(pages.error),
    isFetching: pages.loading || pages.loadingMore,
    isFetchingNextPage: pages.loadingMore,
    items: pages.items.flatMap((page) => page.items),
    loading: enabled ? firstPagePending : !networkError,
    networkError,
    refetch,
    refresh: enabled ? refresh : () => Promise.resolve(),
    retryNetworkSettings: network.refetch,
  };
}
