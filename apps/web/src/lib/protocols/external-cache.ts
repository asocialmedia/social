import type { ExternalPost } from "@asm/protocols/contracts";
import type { QueryClient } from "@tanstack/react-query";

type ExternalState = NonNullable<ExternalPost["asm"]>;

export function patchExternalState(
  data: unknown,
  uri: string,
  state: ExternalState
): unknown {
  if (!data || typeof data !== "object") {
    return data;
  }
  if (Array.isArray(data)) {
    const next = data.map((item) => patchExternalState(item, uri, state));
    return next.some((item, index) => item !== data[index]) ? next : data;
  }
  const record = data as Record<string, unknown>;
  if (record.source === "bluesky" && record.id === uri) {
    return { ...record, asm: state };
  }
  let result = record;
  for (const key of ["pages", "items", "post", "external"]) {
    const next = patchExternalState(record[key], uri, state);
    if (next !== record[key]) {
      if (result === record) {
        result = { ...record };
      }
      result[key] = next;
    }
  }
  return result;
}

export function applyExternalStateToCaches(
  queryClient: QueryClient,
  viewer: string,
  uri: string,
  state: ExternalState
) {
  queryClient.setQueryData(["external-interaction", viewer, uri], state);
  queryClient.setQueriesData(
    {
      predicate: ({ queryKey }) => {
        if (queryKey[0] === "bluesky-discovery") {
          return queryKey[2] === viewer;
        }
        if (queryKey[0] === "bluesky-author-feed") {
          return queryKey[3] === viewer;
        }
        if (queryKey[0] === "external-post") {
          return queryKey[2] === viewer;
        }
        return queryKey[0] === "external-library" && queryKey[1] === viewer;
      },
    },
    (data: unknown) => patchExternalState(data, uri, state)
  );
}
