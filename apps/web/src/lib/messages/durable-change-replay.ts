export const MESSAGE_CHANGE_PAGE_SIZE = 100;
export const MAX_MESSAGE_CHANGE_REPLAY_PAGES = 10;

export interface DurableMessageChange {
  globallyDeleted: boolean;
  hiddenForViewer: boolean;
  id: string;
  kind: string;
  messageId: string | null;
  revision: number;
  sequence: number;
  sourceAvailable: boolean;
  sourceRevision: number | null;
}

export interface DurableMessageChangePage {
  changes: DurableMessageChange[];
  nextCursor: string;
  resetRequired: boolean;
}

export interface DurableMessageChangeReplay {
  changes: DurableMessageChange[];
  cursor: string;
  pages: number;
  resetRequired: boolean;
}

export interface DurableMessageChangeStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export type FetchDurableMessageChangePage = (
  cursor: string | undefined,
  signal: AbortSignal
) => Promise<unknown>;

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseDurableMessageChangePage(
  value: unknown
): DurableMessageChangePage | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const body = value as Record<string, unknown>;
  if (
    typeof body.nextCursor !== "string" ||
    body.nextCursor.length === 0 ||
    body.nextCursor.length > 4096 ||
    typeof body.resetRequired !== "boolean" ||
    !Array.isArray(body.changes)
  ) {
    return null;
  }
  const changes: DurableMessageChange[] = [];
  for (const rawChange of body.changes) {
    if (typeof rawChange !== "object" || rawChange === null) {
      return null;
    }
    const change = rawChange as Record<string, unknown>;
    if (
      typeof change.id !== "string" ||
      typeof change.kind !== "string" ||
      !(typeof change.messageId === "string" || change.messageId === null) ||
      !isRevision(change.revision) ||
      !isRevision(change.sequence) ||
      !(isRevision(change.sourceRevision) || change.sourceRevision === null) ||
      typeof change.sourceAvailable !== "boolean" ||
      typeof change.globallyDeleted !== "boolean" ||
      typeof change.hiddenForViewer !== "boolean"
    ) {
      return null;
    }
    changes.push({
      globallyDeleted: change.globallyDeleted,
      hiddenForViewer: change.hiddenForViewer,
      id: change.id,
      kind: change.kind,
      messageId: change.messageId,
      revision: change.revision,
      sequence: change.sequence,
      sourceAvailable: change.sourceAvailable,
      sourceRevision: change.sourceRevision,
    });
  }
  return {
    changes,
    nextCursor: body.nextCursor,
    resetRequired: body.resetRequired,
  };
}

export async function replayDurableMessageChanges(input: {
  cursor?: string;
  fetchPage: FetchDurableMessageChangePage;
  signal: AbortSignal;
}): Promise<DurableMessageChangeReplay> {
  let { cursor } = input;
  let pages = 0;
  let lastPageWasFull = false;
  const seenCursors = new Set<string>();
  if (cursor) {
    seenCursors.add(cursor);
  }
  const changes: DurableMessageChange[] = [];

  while (pages < MAX_MESSAGE_CHANGE_REPLAY_PAGES) {
    // oxlint-disable-next-line no-await-in-loop -- Each cursor depends on the preceding page.
    const rawPage = await input.fetchPage(cursor, input.signal);
    const parsed = parseDurableMessageChangePage(rawPage);
    if (!parsed) {
      throw new Error("Invalid conversation changes response");
    }
    pages += 1;
    cursor = parsed.nextCursor;
    if (parsed.resetRequired) {
      return { changes, cursor, pages, resetRequired: true };
    }
    changes.push(...parsed.changes);
    lastPageWasFull = parsed.changes.length === MESSAGE_CHANGE_PAGE_SIZE;
    if (!lastPageWasFull) {
      return { changes, cursor, pages, resetRequired: false };
    }
    if (seenCursors.has(cursor)) {
      throw new Error("Conversation changes cursor did not advance");
    }
    seenCursors.add(cursor);
  }

  if (lastPageWasFull) {
    const resetPage = parseDurableMessageChangePage(
      await input.fetchPage(undefined, input.signal)
    );
    if (!resetPage || !resetPage.resetRequired) {
      throw new Error("Conversation changes replay exceeded its safe limit");
    }
    return {
      changes,
      cursor: resetPage.nextCursor,
      pages: pages + 1,
      resetRequired: true,
    };
  }

  if (!cursor) {
    throw new Error("Conversation changes response omitted its cursor");
  }
  return { changes, cursor, pages, resetRequired: false };
}

export function messageChangeCursorStorageKey(
  userId: string,
  conversationId: string
): string {
  return `asm:message-changes:v1:${encodeURIComponent(userId)}:${encodeURIComponent(conversationId)}`;
}

export function readMessageChangeCursor(
  storage: DurableMessageChangeStorage | null,
  userId: string,
  conversationId: string
): string | undefined {
  if (!storage) {
    return undefined;
  }
  try {
    const cursor = storage.getItem(
      messageChangeCursorStorageKey(userId, conversationId)
    );
    return cursor && cursor.length <= 4096 ? cursor : undefined;
  } catch {
    return undefined;
  }
}

export function writeMessageChangeCursor(
  storage: DurableMessageChangeStorage | null,
  userId: string,
  conversationId: string,
  cursor: string
): boolean {
  if (!storage || cursor.length === 0 || cursor.length > 4096) {
    return false;
  }
  try {
    storage.setItem(
      messageChangeCursorStorageKey(userId, conversationId),
      cursor
    );
    return true;
  } catch {
    return false;
  }
}
