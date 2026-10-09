import type { MessagePayload } from "@/lib/messages/crypto";
import { extractSharedRefs } from "@/lib/messages/message-shared-refs";
import type {
  SharedRefKind,
  SharedRefRecord,
} from "@/lib/messages/shared-refs-format";
import { SHARED_REFS_FORMAT_VERSION } from "@/lib/messages/shared-refs-format";
import type { MessageData } from "@/lib/messages/types";

import { hydrateSearchHits } from "./search-hydration";
import type { SearchHydrationHit } from "./search-hydration";
import type { SharedRefsPage } from "./shared-refs-format";

export interface ServerSharedRefItem extends SearchHydrationHit {
  createdAt: string;
  kind: SharedRefKind;
  mediaKind: "gif" | "image" | null;
  ordinal: number;
  requiredId: string | null;
}

export interface ServerSharedRefPage {
  coverageComplete: boolean;
  coverageSettled: boolean;
  hasMore: boolean;
  items: ServerSharedRefItem[];
  nextCursor: string | null;
  snapshotSequence: number;
  window?: {
    hasNewer: boolean;
    hasOlder: boolean;
    newerCursor: string | null;
    olderCursor: string | null;
  };
}

export interface ServerSharedRefAround {
  createdAt: number;
  messageId: string;
  ordinal: number;
}

interface ResolveServerSharedRefPageInput {
  conversationId: string;
  cursor?: string;
  decrypt: (
    messages: readonly MessageData[],
    signal?: AbortSignal
  ) => Promise<ReadonlyMap<string, MessagePayload>>;
  fetcher?: typeof fetch;
  kind: SharedRefKind;
  limit?: number;
  around?: ServerSharedRefAround;
  signal?: AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseServerPage(
  value: unknown,
  expectedKind: SharedRefKind
): ServerSharedRefPage {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("Shared items could not be loaded");
  }
  if (
    typeof value.coverageComplete !== "boolean" ||
    (value.coverageSettled !== undefined &&
      typeof value.coverageSettled !== "boolean") ||
    typeof value.hasMore !== "boolean" ||
    (value.nextCursor !== null && typeof value.nextCursor !== "string") ||
    typeof value.snapshotSequence !== "number" ||
    !Number.isSafeInteger(value.snapshotSequence) ||
    value.snapshotSequence < 0 ||
    value.items.length > 100
  ) {
    throw new Error("Shared items could not be loaded");
  }
  let _window: ServerSharedRefPage["window"];
  if (value.window !== undefined) {
    if (
      !isRecord(value.window) ||
      typeof value.window.hasNewer !== "boolean" ||
      typeof value.window.hasOlder !== "boolean" ||
      (value.window.newerCursor !== null &&
        typeof value.window.newerCursor !== "string") ||
      (value.window.olderCursor !== null &&
        typeof value.window.olderCursor !== "string")
    ) {
      throw new Error("Shared items could not be loaded");
    }
    _window = {
      hasNewer: value.window.hasNewer,
      hasOlder: value.window.hasOlder,
      newerCursor: value.window.newerCursor,
      olderCursor: value.window.olderCursor,
    };
  }
  const items: ServerSharedRefItem[] = [];
  for (const item of value.items) {
    if (
      !isRecord(item) ||
      typeof item.createdAt !== "string" ||
      !Number.isFinite(new Date(item.createdAt).getTime()) ||
      typeof item.messageId !== "string" ||
      typeof item.kind !== "string" ||
      item.kind !== expectedKind ||
      typeof item.keyEpoch !== "number" ||
      !Number.isSafeInteger(item.keyEpoch) ||
      typeof item.ratchetIndex !== "number" ||
      !Number.isSafeInteger(item.ratchetIndex) ||
      typeof item.revision !== "number" ||
      !Number.isSafeInteger(item.revision) ||
      typeof item.senderId !== "string" ||
      typeof item.ordinal !== "number" ||
      !Number.isSafeInteger(item.ordinal) ||
      item.ordinal < 0 ||
      (item.mediaKind !== null &&
        item.mediaKind !== "gif" &&
        item.mediaKind !== "image") ||
      (item.requiredId !== null && typeof item.requiredId !== "string")
    ) {
      throw new Error("Shared items could not be loaded");
    }
    items.push({
      createdAt: item.createdAt,
      id: item.messageId,
      keyEpoch: item.keyEpoch,
      kind: item.kind,
      mediaKind: item.mediaKind,
      ordinal: item.ordinal,
      ratchetIndex: item.ratchetIndex,
      requiredId: item.requiredId,
      revision: item.revision,
      senderId: item.senderId,
    });
  }
  return {
    coverageComplete: value.coverageComplete,
    coverageSettled:
      typeof value.coverageSettled === "boolean"
        ? value.coverageSettled
        : value.coverageComplete,
    hasMore: value.hasMore,
    items,
    nextCursor: value.nextCursor,
    snapshotSequence: value.snapshotSequence,
    ...(_window ? { window: _window } : {}),
  };
}

export async function resolveServerSharedRefsPage(
  input: ResolveServerSharedRefPageInput
): Promise<SharedRefsPage> {
  const fetcher = input.fetcher ?? fetch;
  const query = new URLSearchParams({
    kind: input.kind,
    limit: String(Math.min(Math.max(input.limit ?? 60, 1), 100)),
  });
  if (input.cursor) {
    query.set("cursor", input.cursor);
  }
  if (input.around) {
    query.set(
      "aroundCreatedAt",
      new Date(input.around.createdAt).toISOString()
    );
    query.set("aroundMessageId", input.around.messageId);
    query.set("aroundOrdinal", String(input.around.ordinal));
  }
  const response = await fetcher(
    `/api/messages/conversations/${encodeURIComponent(input.conversationId)}/shared?${query.toString()}`,
    { signal: input.signal }
  );
  if (!response.ok) {
    throw new Error("Shared items could not be loaded");
  }
  const page = parseServerPage(await response.json(), input.kind);
  const hitsById = new Map<string, SearchHydrationHit>();
  for (const item of page.items) {
    hitsById.set(item.id, {
      createdAt: item.createdAt,
      id: item.id,
      keyEpoch: item.keyEpoch,
      ratchetIndex: item.ratchetIndex,
      revision: item.revision,
      senderId: item.senderId,
    });
  }
  const hits = [...hitsById.values()];
  const messages = await hydrateSearchHits({
    conversationId: input.conversationId,
    fetcher,
    hits,
    signal: input.signal,
  });
  const decrypted = await input.decrypt(messages, input.signal);
  const messagesById = new Map(
    messages.map((message) => [message.id, message])
  );
  const refsById = new Map<string, ReturnType<typeof extractSharedRefs>>();
  const items: SharedRefRecord[] = [];
  for (const item of page.items) {
    const message = messagesById.get(item.id);
    const payload = decrypted.get(item.id);
    if (!message || !payload) {
      continue;
    }
    let refs = refsById.get(item.id);
    if (!refsById.has(item.id)) {
      try {
        refs = extractSharedRefs(payload);
      } catch {
        refs = null;
      }
      refsById.set(item.id, refs ?? null);
    }
    const createdAt = new Date(item.createdAt).getTime();
    const base = {
      createdAt,
      index: item.ordinal,
      messageId: item.id,
      senderId: item.senderId,
      version: SHARED_REFS_FORMAT_VERSION,
    };
    if (item.kind === "media") {
      const media = refs?.media.find(
        (reference) => reference.imageIndex === item.ordinal
      );
      if (media) {
        items.push({ ...base, mediaKind: media.kind, url: media.url });
      }
    } else if (item.kind === "post" && item.requiredId) {
      items.push({ ...base, postId: item.requiredId });
    } else if (item.kind === "link") {
      const url = refs?.links[item.ordinal];
      if (url) {
        items.push({ ...base, url });
      }
    }
  }
  return {
    ...(page.nextCursor ? { after: page.nextCursor } : {}),
    coverageComplete: page.coverageComplete,
    coverageSettled: page.coverageSettled,
    hasMore: page.hasMore,
    items,
    ...(page.window ? { window: page.window } : {}),
  };
}
