"use client";

import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { useQueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import type { ReactNode } from "react";
import { useMemo } from "react";

import { parseApiJson } from "@/lib/posts/parse-api-json";
import { shouldPersistFeed } from "@/lib/posts/persisted-feeds";

function feedStorage() {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    // Storage may be disabled by the browser's privacy settings.
  }
}

export function FeedCacheProvider({
  children,
  viewer,
}: {
  children: ReactNode;
  viewer: string;
}) {
  const client = useQueryClient();
  const persistOptions = useMemo(() => {
    const storage = feedStorage();
    const persister = createSyncStoragePersister({
      deserialize: (text) => parseApiJson(text) as PersistedClient,
      key: `asm:feeds:v1:${viewer}`,
      retry: ({ persistedClient }) => {
        const queries = persistedClient.clientState.queries.slice(1);
        return queries.length
          ? {
              ...persistedClient,
              clientState: { ...persistedClient.clientState, queries },
            }
          : undefined;
      },
      serialize: (saved) =>
        JSON.stringify({
          ...saved,
          clientState: {
            ...saved.clientState,
            queries: saved.clientState.queries.map((query) => {
              const data = query.state.data as
                | { pages?: unknown[]; pageParams?: unknown[] }
                | undefined;
              return data?.pages && data.pageParams
                ? {
                    ...query,
                    state: {
                      ...query.state,
                      data: {
                        ...data,
                        pageParams: data.pageParams.slice(0, 3),
                        pages: data.pages.slice(0, 3),
                      },
                    },
                  }
                : query;
            }),
          },
        }),
      storage,
      throttleTime: 1000,
    });
    return {
      buster: "web-feeds-v1",
      dehydrateOptions: {
        shouldDehydrateQuery: (
          query: Parameters<typeof shouldPersistFeed>[0]
        ) => shouldPersistFeed(query, viewer),
      },
      maxAge: 10 * 60 * 1000,
      persister,
    };
  }, [viewer]);

  return (
    <PersistQueryClientProvider client={client} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  );
}
