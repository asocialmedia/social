// Whether a bubble carries its sender's name.
//
// The rule is not "show names in groups" — it is "a name is only worth
// printing when the reader could not otherwise tell who spoke". In a DM that is
// never true: the row has one other person in it, and the header above the
// transcript already names them, so the byline is pure noise repeated twenty
// times down the thread. In a den it usually is true, because twenty people can
// be in the room.
//
// The exception is the run. Consecutive messages from one sender read as a block
// (see getMessageGroupMeta), and a name repeated on every bubble of that block
// shreds the grouping the spacing and corner shaping just built. So the name is
// printed once, on the group's first row — which is exactly the row that already
// carries the tighter top rounding and the divider, so it has somewhere to put it.
//
// Own messages never carry one. The reader knows they wrote it; "You" above your
// own bubble is noise in the same way, and the app's own-message bubbles are
// right-aligned against the edge the name would otherwise hang beside.

import type { ConversationType } from "@asm/db/messages/dens";

export function shouldShowSenderName(input: {
  conversationType: ConversationType;
  isFirstInGroup: boolean;
  mine: boolean;
}): boolean {
  if (input.mine) {
    return false;
  }
  if (input.conversationType !== "DEN") {
    return false;
  }
  return input.isFirstInGroup;
}

// The fallback for a den bubble whose sender could not be resolved — a row whose
// user row was deleted underneath the membership, or a payload decrypted before
// the roster resolved. Not empty: an unattributed bubble in a room full of
// people reads as something the reader typed, which is the one wrong answer.
export const DEN_UNKNOWN_SENDER_NAME = "Unknown";
