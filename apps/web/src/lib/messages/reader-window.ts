// Which messages a reader is entitled to see in a conversation, by WHEN.
//
// Two windows, and both are about the reader's own membership row rather than about
// the messages:
//
//   - a reader who has LEFT is capped at the moment they left, so a reload cannot
//     page in ciphertext from after the departure;
//   - a reader who has JOINED is floored at the moment they joined, so a newcomer is
//     not handed the history of a room they were not in.
//
// The upper bound existed first. The lower bound is this module's other half, and it
// is a correctness fix rather than a privacy nicety: a genuine newcomer holds no
// wrap for any epoch minted before they arrived, so every pre-join row arrives as
// ciphertext this device cannot decrypt. Showing it anyway put a wall of "could not
// be decrypted" bubbles in front of somebody who had just been invited, and the
// honest answer to that screen is that the history was never theirs to read.
//
// Three details that are easy to get wrong and are stated here rather than at each
// call site:
//
//   - A REJOIN keeps the original membership row, so its `createdAt` is still the
//     first time this person was ever in this room. Somebody who left and came back
//     must get their whole history back, which means the floor has to read the
//     original join and not the rejoin.
//   - A DM row carries no `leftAt`, so it is never "departed"; the same absence must
//     not read as a floor of the epoch, or every DM would come back empty.
//   - A member row with neither bound - an unresolved snapshot, a trimmed payload -
//     means "no window", which is the direction that admits rather than hides. A
//     bound that cannot be read must not silently become a floor at the epoch.

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
