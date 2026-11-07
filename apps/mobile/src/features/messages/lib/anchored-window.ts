import { shouldReplaceMessageRevision } from "./message-revision";
// Reconciling an anchored read with whatever the transcript gained while it
// was in flight, ported from apps/web/src/lib/messages/anchored-window.ts.
//
// A search jump lands by REPLACING the loaded window: one `?around=` read
// returns rows centred on the target, and those become the whole transcript.
// The replacement used to be a blind write: between issuing the read and
// writing its answer, a live arrival (or a reconnect catch-up) could fold into
// the store, and the blind write discarded it.
//
// The rule is narrow on purpose: a message is preserved only if the anchored
// window cannot already contain it, which means it arrived after the read was
// issued. Messages the window DOES cover are dropped, because the server sent
// them again and keeping the old copy would duplicate the row. Everything else
// -- including a newer edit or deletion received during the request -- must
// respect the source revision rather than the order in which responses arrive.
//
// Pure, and tested without a React harness, because the rule is the whole fix.
import type { MessageData, MessagePage } from "./types";

export type MessageHistoryPageParam =
  | { cursor?: string; kind: "older" }
  | { kind: "around"; messageId: string }
  | { cursor: string; kind: "newer" };

export function messageWindowIncludesLatest(
  pages: readonly MessagePage[],
  pageParams: readonly MessageHistoryPageParam[]
): boolean {
  if (pages.length === 0 || pages.length !== pageParams.length) {
    return false;
  }
  const lastParam = pageParams.at(-1);
  return (
    (lastParam?.kind === "older" && !lastParam.cursor) ||
    pages.at(-1)?.nextCursor === null
  );
}

export function shouldFoldLiveMessage(input: {
  pageParams: readonly MessageHistoryPageParam[];
  pages: readonly MessagePage[];
  pinned: boolean;
}): boolean {
  return (
    input.pinned && messageWindowIncludesLatest(input.pages, input.pageParams)
  );
}

// Newest last, matching every page the messages API returns.
function isNewerThan(candidate: MessageData, reference: MessageData): boolean {
  const at = new Date(candidate.createdAt).getTime();
  const was = new Date(reference.createdAt).getTime();
  if (at !== was) {
    return at > was;
  }
  // Same millisecond: the id is the only stable tiebreak there is, and a
  // lexicographic comparison is total, so the choice cannot oscillate.
  return candidate.id > reference.id;
}

// Folds a message onto the tail of a page, skipping one already present.
function appendIfAbsent(
  page: MessagePage,
  message: MessageData
): MessagePage | null {
  if (page.messages.some((row) => row.id === message.id)) {
    return null;
  }
  return { ...page, messages: [...page.messages, message] };
}

// The window a search jump installs, with anything the transcript gained while
// the read was in flight carried across.
//
// `currentPages` is the store as it stands NOW, which may already include a
// live arrival, a prepended page, or both. Returns the single page to install.
export function reconcileAnchoredWindow(input: {
  carryArrivals?: boolean;
  // The rows the anchored read returned, as the server sent them.
  fetched: MessagePage;
  // The transcript as it stands at write time. Empty or absent is normal: the
  // read may have been the first thing to touch this conversation.
  currentPages?: readonly MessagePage[] | null;
  // The rows present when the read was ISSUED. Anything in `currentPages` that
  // is not here, and that the fetched window does not cover, arrived during
  // the read and is what this function is here to not lose.
  issuedIds: ReadonlySet<string>;
}): MessagePage {
  const { currentPages, issuedIds } = input;
  let { fetched } = input;
  if (!currentPages || currentPages.length === 0) {
    return fetched;
  }
  const currentById = new Map<string, MessageData>();
  for (const currentPage of currentPages) {
    for (const row of currentPage.messages) {
      const previous = currentById.get(row.id);
      if (!previous || shouldReplaceMessageRevision(previous, row)) {
        currentById.set(row.id, row);
      }
    }
  }
  let revisionsChanged = false;
  const messages = fetched.messages.map((row) => {
    const current = currentById.get(row.id);
    if (current && !shouldReplaceMessageRevision(current, row)) {
      revisionsChanged ||= current !== row;
      return current;
    }
    return row;
  });
  if (revisionsChanged) {
    fetched = { ...fetched, messages };
  }
  if (input.carryArrivals === false) {
    return fetched;
  }
  const fetchedIds = new Set(fetched.messages.map((row) => row.id));
  // The newest row the anchored window holds. Anything newer than this is, by
  // construction, outside the window the server chose -- so it is a live
  // arrival rather than a row the read duplicated.
  const newest = fetched.messages.at(-1);
  if (!newest) {
    return fetched;
  }
  const carried = (currentPages ?? [])
    .flatMap((page) => page.messages)
    .filter(
      (row) =>
        !issuedIds.has(row.id) &&
        !fetchedIds.has(row.id) &&
        isNewerThan(row, newest)
    );
  if (carried.length === 0) {
    return fetched;
  }
  // Dedupe across pages too: a reconnect can land the same arrival twice, and
  // the anchored window is being written from two sources here.
  const seen = new Set<string>();
  let merged = fetched;
  for (const row of carried) {
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    const next = appendIfAbsent(merged, row);
    if (next) {
      merged = next;
    }
  }
  return merged;
}

export function buildAnchoredMessageWindow(input: {
  currentPages?: readonly MessagePage[] | null;
  fetched: MessagePage;
  issuedIds: ReadonlySet<string>;
  messageId: string;
}): { pageParams: MessageHistoryPageParam[]; pages: MessagePage[] } {
  return {
    pageParams: [{ kind: "around", messageId: input.messageId }],
    pages: [
      reconcileAnchoredWindow({
        ...input,
        // Older windows keep arrivals in the separate live-tail summary.
        carryArrivals: input.fetched.nextCursor === null,
      }),
    ],
  };
}
