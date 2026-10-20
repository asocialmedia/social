import type { ExternalPost } from "@asm/protocols/contracts";
import {
  externalPostSchema,
  externalAuthorSchema,
} from "@asm/protocols/discovery";
import type { ExternalMutation } from "@asm/protocols/discovery";
import type { QueryClient } from "@tanstack/react-query";

type ExternalState = NonNullable<ExternalPost["asm"]>;

export function cachedExternalAuthor(
  data: unknown,
  actor: string
): ExternalPost["author"] | undefined {
  if (!data || typeof data !== "object") {
    return;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = cachedExternalAuthor(item, actor);
      if (found) {
        return found;
      }
    }
    return;
  }
  const record = data as Record<string, unknown>;
  if (
    record.source === "bluesky" &&
    (record.id === actor || record.handle === actor)
  ) {
    const parsed = externalAuthorSchema.safeParse(data);
    if (parsed.success) {
      return parsed.data;
    }
  }
  for (const key of ["pages", "items", "post", "external", "author"]) {
    const found = cachedExternalAuthor(record[key], actor);
    if (found) {
      return found;
    }
  }
}

export function optimisticExternalState(
  state: ExternalState,
  input: ExternalMutation
): ExternalState {
  if (input.action === "bookmark") {
    return { ...state, bookmarked: input.active };
  }
  if (input.action === "amplify") {
    return {
      ...state,
      amplifications: Math.max(
        0,
        state.amplifications + Number(input.active) - Number(state.amplified)
      ),
      amplified: input.active,
    };
  }
  return state;
}

export function isExternalViewerQuery(key: readonly unknown[], viewer: string) {
  if (
    key[0] === "bluesky-discovery" ||
    key[0] === "bluesky-following" ||
    key[0] === "external-post"
  ) {
    return key[2] === viewer;
  }
  if (key[0] === "bluesky-author-feed") {
    return key[3] === viewer;
  }
  return key[0] === "external-library" && key[1] === viewer;
}

export function cachedExternalPost(
  data: unknown,
  uri: string
): ExternalPost | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = cachedExternalPost(item, uri);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  const record = data as Record<string, unknown>;
  if (record.id === uri && record.source === "bluesky") {
    const parsed = externalPostSchema.safeParse(data);
    if (parsed.success) {
      return parsed.data;
    }
  }
  for (const key of ["pages", "items", "post", "external"]) {
    const found = cachedExternalPost(record[key], uri);
    if (found) {
      return found;
    }
  }
  return undefined;
}

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
      predicate: ({ queryKey }) => isExternalViewerQuery(queryKey, viewer),
    },
    (data: unknown) => patchExternalState(data, uri, state)
  );
}
