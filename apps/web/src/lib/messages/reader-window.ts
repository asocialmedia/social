// Which messages a reader is entitled to see in a conversation, by WHEN.
//
// The entitlement is a set of windows, and every window is about the reader's own
// membership rather than about the messages:
//
//   - a reader who has LEFT is capped at the moment they left, so a reload cannot
//     page in ciphertext from after the departure;
//   - a reader who has JOINED is floored at the moment they joined, so a newcomer
//     is not handed the history of a room they were not in;
//   - a reader who LEFT AND CAME BACK holds one window per stint, so the stretch
//     they were gone stays hidden even though the stints on both sides of it stay
//     readable.
//
// The upper bound existed first. The lower bound is a correctness fix rather than
// a privacy nicety: a genuine newcomer holds no wrap for any epoch minted before
// they arrived, so every pre-join row arrives as ciphertext this device cannot
// decrypt. Showing it anyway put a wall of "could not be decrypted" bubbles in
// front of somebody who had just been invited, and the honest answer to that
// screen is that the history was never theirs to read. The gap between two stints
// is the same answer one step further: the rejoiner holds no wrap for the epochs
// minted while they were away, and the heal gate (`cannotHealIntoEpoch` in
// `client.ts`) refuses to hand those epochs to them.
//
// Details that are easy to get wrong and are stated here rather than at each call
// site:
//
//   - A REJOIN keeps the original membership row, so the row alone cannot express
//     "in, out, in again": its `createdAt` is still the first join and its
//     `leftAt` is cleared. The per-stint boundaries live in the den's durable
//     membership log (`MessageConversationMembershipEvents`), which is why the
//     plural builder takes that log. With no log lines for the reader - a
//     membership older than the log itself - the answer is the single row window,
//     which is the behaviour this module had before stints existed.
//   - A DM row carries no `leftAt`, so it is never "departed"; the same absence
//     must not read as a floor of the epoch, or every DM would come back empty. A
//     DM also has no membership log, so it always answers the single unfloored
//     window.
//   - A member row with neither bound - an unresolved snapshot, a trimmed payload -
//     means "no window", which is the direction that admits rather than hides. A
//     bound that cannot be read must not silently become a floor at the epoch.
//   - Window bounds are INCLUSIVE on both ends. Two events the database put in
//     one millisecond cannot be ordered against each other, and an exclusive
//     bound would drop a message that shared its millisecond with a join or a
//     leave.

import type { ConversationType } from "@asm/db/messages/dens";

// The membership facts the window is decided from. `createdAt` is the row's own
// creation, which is the reader's FIRST join; `leftAt` is null while they are
// inside and set the moment they go.
export interface ReaderMembershipWindow {
  createdAt: Date | null;
  leftAt: Date | null;
}

export interface ReaderMessageWindow {
  // Null means no bound on that side, which is the answer for a current member's
  // future and for any reader whose membership could not be read.
  after: Date | null;
  before: Date | null;
}

// The membership-log facts a stint boundary is decided from, structurally: the
// service's `DenMembershipEvent` satisfies this without an import, and a test can
// build it by hand. The subject of a line is `targetUserId ?? actorId`: a join or
// leave names the person acting on themselves in `actorId` with a null target,
// while a removal or an add names the manager in `actorId` and the subject in
// `targetUserId`.
export interface ReaderMembershipEvent {
  action: string;
  actorId: string | null;
  createdAt: Date;
  targetUserId: string | null;
}

// Lines that open a stint, and lines that close one. Role movements (PROMOTED,
// DEMOTED, OWNER_TRANSFERRED) say nothing about presence and are ignored.
const STINT_OPEN_ACTIONS = new Set(["CREATED", "JOINED"]);
const STINT_CLOSE_ACTIONS = new Set(["LEFT", "REMOVED"]);

// Nothing known about this reader's membership, so nothing is withheld.
//
// The deliberate failure direction. Every use of this window is a filter on a
// transcript a member is entitled to, and a filter that cannot decide should show
// the conversation rather than blank it - the route's own membership gate has
// already answered whether this reader may be here at all.
export function openMessageWindow(): ReaderMessageWindow {
  return { after: null, before: null };
}

// The window for one reader, given the conversation type and their membership row.
//
// `membership` is null when the caller has no row for this reader at all, which is
// the shape an unresolved snapshot arrives in and is treated as no window for the
// same reason `openMessageWindow` exists.
export function readerMessageWindow(input: {
  conversationType: ConversationType;
  membership: ReaderMembershipWindow | null | undefined;
}): ReaderMessageWindow {
  const { membership } = input;
  if (!membership) {
    return openMessageWindow();
  }
  // The departure bound is the one that applies to both kinds of conversation: it is
  // about the reader leaving, and only a den can be left.
  const before = membership.leftAt ?? null;
  // The join floor is den-only. A DM has exactly two participants, both of whom were
  // there at the start, so there is no window in which either of them was absent -
  // and a DM membership row has no meaningful `createdAt` to floor against.
  if (input.conversationType !== "DEN") {
    return { after: null, before };
  }
  const after = membership.createdAt ?? null;
  // A departure before the join would produce an empty window, which can only happen
  // if the row was rewritten rather than updated. Answering "no window" is the
  // honest reading of a record that contradicts itself, and it keeps a rewritten row
  // from making a conversation permanently unreadable.
  if (after !== null && before !== null && before < after) {
    return openMessageWindow();
  }
  return { after, before };
}

// The windows for one reader as a LIST, one per stint they spent inside a den.
//
// This is the form every den read should use: the singular
// `readerMessageWindow` above sees only the membership row, and the row alone
// cannot tell "joined once" apart from "left and came back", because a rejoin
// clears `leftAt` on the original row rather than writing a new one. The stint
// boundaries are the den's membership log, oldest first, exactly as
// `listDenMembershipEvents` returns it.
//
// The answer always has at least one entry, and the entries are in the order the
// log records them. The cases that have no log answer at all - a DM, an
// unresolved membership, a membership older than the log - fall back to the
// single row window, so a caller switching from the singular to the plural form
// changes nothing for every reader who never left.
export function readerMessageWindows(input: {
  conversationType: ConversationType;
  events?: readonly ReaderMembershipEvent[] | null;
  membership: ReaderMembershipWindow | null | undefined;
  userId: string;
}): ReaderMessageWindow[] {
  const { membership } = input;
  // Everything that is not a legible den membership answers exactly what the
  // singular form answers, as a one-entry list. That keeps the failure direction
  // of every odd shape identical to the behaviour the routes already had.
  if (input.conversationType !== "DEN" || !membership) {
    return [readerMessageWindow(input)];
  }
  const after = membership.createdAt ?? null;
  const before = membership.leftAt ?? null;
  // The self-contradictory row safeguard, kept verbatim from the singular form:
  // a departure before the join means the row was rewritten rather than updated,
  // and admitting is what keeps the conversation readable.
  if (after !== null && before !== null && before < after) {
    return [openMessageWindow()];
  }
  const stints = (input.events ?? []).filter((event) => {
    const subject = event.targetUserId ?? event.actorId;
    return (
      subject === input.userId &&
      (STINT_OPEN_ACTIONS.has(event.action) ||
        STINT_CLOSE_ACTIONS.has(event.action))
    );
  });
  if (stints.length === 0) {
    // No log lines for this reader at all: a membership that predates the log,
    // or a caller that could not load it. The row window is the honest answer
    // either way, and it is what every reader got before stints existed.
    return [readerMessageWindow(input)];
  }
  const windows: ReaderMessageWindow[] = [];
  let open: Date | undefined;
  for (const stint of stints) {
    if (STINT_OPEN_ACTIONS.has(stint.action)) {
      // A second opener without a close between them is a log anomaly; keeping
      // the EARLIER opener is the direction that hides less.
      if (open === undefined) {
        open = stint.createdAt;
      }
      continue;
    }
    // A close with no opener in the log means the membership itself predates
    // the log: the stint opened when the row says it did. `after` may itself be
    // null, which reads as "no floor", the same direction the row window takes
    // for an unreadable join.
    windows.push({ after: open ?? after, before: stint.createdAt });
    open = undefined;
  }
  if (open !== undefined) {
    // Still inside (or the row's `leftAt` closes the last stint when the log's
    // close line was trimmed by the reader's own departure cutoff).
    windows.push({ after: open, before });
  }
  // A walk that produced nothing can only come from a log that contradicts the
  // row; the row window is the readable answer.
  return windows.length > 0 ? windows : [readerMessageWindow(input)];
}

// Whether a moment falls inside any of a reader's windows, inclusively.
//
// The JS half of the SQL ranges the messages route builds from the same windows:
// the list preview already holds its rows, so it asks this rather than issuing a
// query, and the two must agree on the inclusivity of the bounds.
export function readerWindowsContain(
  windows: readonly ReaderMessageWindow[],
  at: Date
): boolean {
  const atMs = at.getTime();
  return windows.some((window) => {
    if (window.after !== null && atMs < window.after.getTime()) {
      return false;
    }
    return window.before === null || atMs <= window.before.getTime();
  });
}
