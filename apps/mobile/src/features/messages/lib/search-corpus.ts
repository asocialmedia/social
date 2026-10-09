import type { DecryptEntry } from "./decryptor";
import {
  extractSearchableText,
  MAX_SEARCH_INDEX_MESSAGES,
} from "./message-search";
import type { SearchCandidate } from "./message-search";
import type { MessageData } from "./types";

export interface SearchCorpus {
  scope: string | null;
  rows: ReadonlyMap<string, SearchCandidate>;
}

export function collectSearchCorpus(
  current: SearchCorpus,
  scope: string | null,
  messages: MessageData[],
  decrypted: ReadonlyMap<string, DecryptEntry | undefined>
): SearchCorpus {
  let changed = current.scope !== scope;
  const next = new Map(changed || !scope ? [] : current.rows);
  if (!scope) {
    return { rows: next, scope };
  }
  const liveIds = new Set(
    messages
      .filter((message) => !message.deletedAt)
      .map((message) => message.id)
  );
  for (const id of next.keys()) {
    if (!liveIds.has(id)) {
      next.delete(id);
      changed = true;
    }
  }
  for (const message of messages) {
    if (message.deletedAt) {
      continue;
    }
    const payload = decrypted.get(message.id);
    if (!payload || typeof payload !== "object") {
      continue;
    }
    const { text } = extractSearchableText(payload);
    if (
      next.get(message.id)?.text === text ||
      (next.size >= MAX_SEARCH_INDEX_MESSAGES && !next.has(message.id))
    ) {
      continue;
    }
    next.set(message.id, {
      createdAt: Date.parse(message.createdAt),
      id: message.id,
      text,
    });
    changed = true;
  }
  return changed ? { rows: next, scope } : current;
}
