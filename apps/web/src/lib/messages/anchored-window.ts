// Reconciling an anchored read with whatever the transcript gained while it was
// in flight.
//
// A search jump lands by REPLACING the loaded window: one `?around=` read returns
// a hundred rows centred on the target, and those become the whole transcript,
// because the point is to be O(limit) rather than walking from the newest message.
// The replacement used to be a blind write.
//
// That is a lost-message race, and it is not exotic. Between issuing the read and
// writing its answer, any of three things can land in the same query cache:
//
// - the peer sends a message, and the realtime handler folds it onto the last
//   page;
// - a reconnect fires its catch-up invalidation;
// - the boundary auto-loader prepends a page.
//
// The blind write then discards all of it. The user's transcript silently loses
// a message they were told arrived -- and because the fold is also what marks it
// read, the badge and the read receipt disagree with what is on screen.
//
// The rule here is narrow on purpose: a message is preserved only if the anchored
// window cannot already contain it, which means it arrived after the read was
// issued. Messages the window DOES cover are dropped, because the server sent
// them again and keeping the old copy would duplicate the row. Everything else --
// including an edit to a row the window holds -- is the server's answer, and the
// server's answer is the fresher copy.
//
// Pure, and tested without a React harness, because the rule is the whole fix and
// the harness this package does not have would otherwise be the only way to reach
// it.

import type { MessageData, MessagePage } from "@/lib/messages/types";

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
// `currentPages` is the cache as it stands NOW, which may already include a live
// arrival, a prepended page, or both. Returns the single page to install.
export function reconcileAnchoredWindow(input: {
  // The rows the anchored read returned, as the server sent them.
  fetched: MessagePage;
  // The transcript as it stands at write time. Empty or absent is normal: the
  // read may have been the first thing to touch this conversation.
  currentPages?: readonly MessagePage[] | null;
  // The rows present when the read was ISSUED. Anything in `currentPages` that is
  // not here, and that the fetched window does not cover, arrived during the
  // read and is what this function is here to not lose.
  issuedIds: ReadonlySet<string>;
}): MessagePage {
  const { currentPages, fetched, issuedIds } = input;
  if (!currentPages || currentPages.length === 0) {
    return fetched;
  }
  const fetchedIds = new Set(fetched.messages.map((row) => row.id));
  // The newest row the anchored window holds. Anything newer than this is, by
  // construction, outside the window the server chose -- so it is a live arrival
  // rather than a row the read duplicated.
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
  // Dedupe across pages too: a reconnect can land the same arrival twice, and the
  // anchored window is being written from two sources here.
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
