import type { MessageData } from "./types";

export interface SearchHydrationHit {
  createdAt: string;
  id: string;
  keyEpoch: number;
  ratchetIndex: number;
  revision: number;
  senderId: string;
}

interface HydratedSearchRow extends SearchHydrationHit {
  ciphertext: string;
  iv: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHydratedSearchRow(value: unknown): HydratedSearchRow | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.ciphertext !== "string" ||
    typeof value.createdAt !== "string" ||
    Number.isNaN(new Date(value.createdAt).getTime()) ||
    typeof value.id !== "string" ||
    typeof value.iv !== "string" ||
    typeof value.keyEpoch !== "number" ||
    !Number.isSafeInteger(value.keyEpoch) ||
    typeof value.ratchetIndex !== "number" ||
    !Number.isSafeInteger(value.ratchetIndex) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    typeof value.senderId !== "string"
  ) {
    return null;
  }
  return {
    ciphertext: value.ciphertext,
    createdAt: value.createdAt,
    id: value.id,
    iv: value.iv,
    keyEpoch: value.keyEpoch,
    ratchetIndex: value.ratchetIndex,
    revision: value.revision,
    senderId: value.senderId,
  };
}

function sameSearchRevision(
  requested: SearchHydrationHit,
  hydrated: HydratedSearchRow
): boolean {
  return (
    requested.createdAt === hydrated.createdAt &&
    requested.id === hydrated.id &&
    requested.keyEpoch === hydrated.keyEpoch &&
    requested.ratchetIndex === hydrated.ratchetIndex &&
    requested.revision === hydrated.revision &&
    requested.senderId === hydrated.senderId
  );
}

export async function hydrateSearchHits(input: {
  conversationId: string;
  hits: readonly SearchHydrationHit[];
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<MessageData[]> {
  if (input.hits.length > 20) {
    throw new RangeError("A search page cannot hydrate more than 20 hits");
  }
  const expectedById = new Map(input.hits.map((hit) => [hit.id, hit]));
  if (expectedById.size !== input.hits.length) {
    throw new TypeError("Search results contain duplicate message ids");
  }
  const hydratedById = new Map<string, MessageData>();
  let pending = [...input.hits];
  const fetcher = input.fetcher ?? fetch;

  while (pending.length > 0) {
    const batch = pending.slice(0, 20);
    // oxlint-disable-next-line no-await-in-loop -- deferred batches depend on the prior response's byte budget.
    const response = await fetcher(
      `/api/messages/conversations/${encodeURIComponent(input.conversationId)}/messages/batch`,
      {
        body: JSON.stringify({
          messages: batch.map(({ id, revision }) => ({ id, revision })),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: input.signal,
      }
    );
    if (!response.ok) {
      throw new Error("Search results could not be loaded");
    }
    // oxlint-disable-next-line no-await-in-loop -- parse each bounded batch before deciding whether another is needed.
    const payload: unknown = await response.json();
    if (
      !isRecord(payload) ||
      !Array.isArray(payload.messages) ||
      !Array.isArray(payload.unavailableIds) ||
      !payload.unavailableIds.every((id) => typeof id === "string") ||
      !Array.isArray(payload.deferredIds) ||
      !payload.deferredIds.every((id) => typeof id === "string")
    ) {
      throw new Error("Search results could not be loaded");
    }

    const batchById = new Map(batch.map((hit) => [hit.id, hit]));
    const accountedFor = new Set<string>();
    for (const value of payload.messages) {
      const hydrated = parseHydratedSearchRow(value);
      if (!hydrated || accountedFor.has(hydrated.id)) {
        throw new Error("Search results could not be loaded");
      }
      const expected = batchById.get(hydrated.id);
      if (!expected || !sameSearchRevision(expected, hydrated)) {
        throw new Error("Search results changed. Search again.");
      }
      accountedFor.add(hydrated.id);
      hydratedById.set(hydrated.id, {
        ciphertext: hydrated.ciphertext,
        conversationId: input.conversationId,
        createdAt: new Date(hydrated.createdAt),
        deletedAt: null,
        editedAt: null,
        id: hydrated.id,
        iv: hydrated.iv,
        keyEpoch: hydrated.keyEpoch,
        ratchetIndex: hydrated.ratchetIndex,
        revision: hydrated.revision,
        sender: null,
        senderId: hydrated.senderId,
      });
    }

    const unavailableIds = payload.unavailableIds as string[];
    const deferredIds = payload.deferredIds as string[];
    for (const id of [...unavailableIds, ...deferredIds]) {
      if (!batchById.has(id) || accountedFor.has(id)) {
        throw new Error("Search results could not be loaded");
      }
      accountedFor.add(id);
    }
    if (accountedFor.size !== batch.length) {
      throw new Error("Search results could not be loaded");
    }

    const deferred = new Set(deferredIds);
    const nextPending = [
      ...pending.slice(batch.length),
      ...batch.filter((hit) => deferred.has(hit.id)),
    ];
    if (nextPending.length >= pending.length) {
      throw new Error("Search results could not be loaded");
    }
    pending = nextPending;
  }

  return input.hits.flatMap((hit) => {
    const message = hydratedById.get(hit.id);
    return message ? [message] : [];
  });
}
