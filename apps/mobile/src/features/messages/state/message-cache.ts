import type { ConversationListResponse } from "../lib/client";
import type { MessagePage } from "../lib/types";
import { conversationListStore } from "./conversation-list-store";
import { transcriptStore } from "./transcript-store";

interface CiphertextCache {
  list: ConversationListResponse;
  scope: string;
  listFetchedAt: number;
  transcripts: Record<string, { fetchedAt: number; page: MessagePage }>;
}

export function messageCacheScope(
  apiBase: string,
  userId: string,
  identityPublicKey: string
): string {
  return JSON.stringify([apiBase, userId, identityPublicKey]);
}

let scope: string | null = null;
let generation = 0;
let hydration: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let subscriptions: (() => void)[] = [];

function cacheName(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + (value.codePointAt(index) ?? 0)) % 4_294_967_296;
  }
  return `messages-ciphertext-v1-${hash.toString(16)}`;
}

// Persist encrypted rows only; decrypted previews, payloads and key material stay in memory.
function schedulePersist(): void {
  if (timer) {
    clearTimeout(timer);
  }
  const owner = scope;
  const revision = generation;
  timer = setTimeout(() => {
    timer = null;
    if (!owner || revision !== generation) {
      return;
    }
    const data: CiphertextCache = {
      list: conversationListStore.exportCiphertextResponse(),
      listFetchedAt: conversationListStore.getUpdatedAt(),
      scope: owner,
      transcripts: transcriptStore.exportCiphertextPages(),
    };
    void (async () => {
      try {
        const { writeSnapshot } = await import("@/lib/persistent-file");
        if (revision !== generation) {
          return;
        }
        await writeSnapshot(cacheName(owner), {
          entries: { messages: { data, fetchedAt: Date.now() } },
          version: 1,
        });
      } catch {
        // Cache IO is best effort.
      }
    })();
  }, 500);
}

export function clearMessageCacheSession(): void {
  generation += 1;
  scope = null;
  hydration = null;
  if (timer) {
    clearTimeout(timer);
  }
  timer = null;
  for (const unsubscribe of subscriptions) {
    unsubscribe();
  }
  subscriptions = [];
}

export function hydrateMessageCache(
  apiBase: string,
  userId: string,
  identityPublicKey: string
): Promise<void> {
  const owner = messageCacheScope(apiBase, userId, identityPublicKey);
  if (scope === owner && hydration) {
    return hydration;
  }
  clearMessageCacheSession();
  conversationListStore.reset();
  transcriptStore.clearAll();
  scope = owner;
  const revision = generation;
  hydration = (async () => {
    try {
      const { readSnapshot } = await import("@/lib/persistent-file");
      const snapshot = await readSnapshot<CiphertextCache>(cacheName(owner));
      const entry = snapshot.entries.messages;
      const data = entry?.data;
      if (
        revision !== generation ||
        data?.scope !== owner ||
        !entry ||
        Date.now() - entry.fetchedAt > 7 * 24 * 60 * 60 * 1000
      ) {
        return;
      }
      if (
        Array.isArray(data.list?.items) &&
        data.list.items.every((item) =>
          Array.isArray(item.conversation?.members)
        )
      ) {
        conversationListStore.replaceAll(data.list, userId, data.listFetchedAt);
      }
      for (const [id, saved] of Object.entries(data.transcripts ?? {})) {
        const { page } = saved;
        if (
          Array.isArray(page.messages) &&
          page.messages.every(
            (message) =>
              typeof message.id === "string" &&
              typeof message.ciphertext === "string" &&
              typeof message.iv === "string"
          )
        ) {
          transcriptStore.setPages(id, page, saved.fetchedAt);
        }
      }
    } catch {
      // A corrupt cache is discarded while server history remains intact.
    }
  })();
  void (async () => {
    await hydration;
    if (revision !== generation) {
      return;
    }
    subscriptions = [
      conversationListStore.subscribe(schedulePersist),
      transcriptStore.subscribe(schedulePersist),
    ];
  })();
  return hydration;
}
