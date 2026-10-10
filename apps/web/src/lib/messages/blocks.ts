import type { ConversationType } from "@asm/db";

// The one place a block is given meaning inside a conversation, shared by every
// surface that has to answer "does this block apply here": the conversation list,
// the conversation detail gate, the unread badge seed, the send path, and the
// message write paths for delete and edit.
//
// Pure, and in its own module on purpose. The rules are small, but surfaces that
// each re-derived them were already drifting: the badge seed resolved "the peer"
// with a `.first()` over a membership table, which is only true of a DM, so a den
// containing a blocked person was sometimes excluded from the badge and sometimes
// kept. The message delete and edit routes had the same `.first()` and could not
// even see the conversation's type, which made a member's ability to correct or
// retract their own words in a 100-member room depend on which member the roster
// returned first. Keeping the predicates here means a surface that forgets the
// question is visibly missing a call rather than quietly re-deriving an answer.
//
// The rule itself, stated once:
//
//   A block is a DM-ONLY rule, and a DM is the only place it has force.
//
//   Two blocked people cannot open a conversation with each other, cannot read
//   one they already have, cannot send into one, and cannot correct or retract
//   anything in one. That is every guarantee a block makes, and it is unchanged.
//
//   A den is a different kind of thing entirely: a shared space with up to
//   DEN_LIMITS.membersMax members. It admits regardless of blocks. There is no
//   door check at create, at add or at join, and there is no inside check - the
//   predicates below are what a den path calls to LEARN that it must skip, not
//   to decide something.
//
//   Why not the old rule, which refused a den that would hold a blocked pair:
//
//   - At DEN_LIMITS.membersMax people, "these two must not be in one room" is not
//     something a member can reason about. Refusing it meant one pair's private
//     disagreement overrode the other ninety-eight people's ability to be in the
//     room at all.
//   - The refusal was all-or-nothing. One blocked pair refused the WHOLE request,
//     including the innocent candidates who were about to be added alongside
//     them. A rule with a blast radius that wide is a rule nobody understands.
//   - It did not even hold. Any third party with no block relationship to either
//     party could bring the pair together anyway, so what it bought was a
//     confusing refusal rather than a guarantee.
//   - A blocked member's remedy for a den they do not want to be inside is to
//     LEAVE. That is a decision they get to make, on their own account, and it
//     is strictly better than a third party deciding for them at a door.
//
//   None of this is a weakening. The DM guarantee above is untouched, and there was
//   never much to weaken in a den: the scheme is server-recoverable, so a member of
//   a den can already read the server's copy of every message in it. Hiding one
//   member's messages from the other ninety-nine would protect nothing, cost every
//   read a per-recipient filter, and still leak through the count and the ordering.
//
// What is NOT affected, and why, so nobody goes looking for a fourth surface:
// media. An attachment is an opaque blob the client encrypted; it is served by
// the ordinary media route from an object key, and it was encrypted by whoever
// sent it for whoever it was addressed to. There is no conversation-gated media
// path to apply a block to, for a DM or for a den, so there is nothing here to
// keep consistent. The one conversation-scoped media surface is a member's own
// chat wallpaper, which lives on THEIR row and is served to THEM - a blocked
// pair's wallpapers were never shared, and still are not.

// The other member of a two-person conversation: the caller, or undefined when
// the caller is the only member. Takes a roster rather than a conversation
// because the two call sites that need it hold differently-shaped payloads (a
// mapped conversation, a raw membership row) and both were writing this lookup
// themselves.
export function dmPeerId(
  roster: readonly { userId: string }[],
  userId: string
): string | undefined {
  return roster.find((member) => member.userId !== userId)?.userId;
}

// Whether a block applies to this kind of conversation at all.
//
// This is the single answer, and for a den it is no: a block is a DM-only rule.
// Split out from `isHiddenByBlock` for the callers that must decide BEFORE they
// spend a query: the media byte-serving path, and the send path. Both can either
// probe for a peer and then ask the full question, or skip the probe entirely -
// and the second is what they want on the hottest paths, because for a den there
// is no peer and a lookup would find an arbitrary member.
//
// One predicate, so a conversation type that ever does carry a block rule has to be
// added here once, and every caller that skips its probe follows. The den paths
// read it to learn that they must SKIP; they never ask it to refuse anything,
// because a den admits regardless of blocks (see the header above).
export function isBlockPairRule(conversationType: ConversationType): boolean {
  return conversationType === "DM";
}

// Whether a conversation is hidden from `userId` because of a block.
//
// `otherMemberId` is the peer for a DM and ignored for a den. The caller has
// already resolved membership, so this is a pure predicate over data in hand. A
// den is admitted by this question whichever way it is answered: a den is a room,
// not a pair, and revoking one member's access because of a disagreement between
// two of its ninety-nine would hand that decision to the two of them.
export function isHiddenByBlock(
  conversationType: ConversationType,
  otherMemberId: string | undefined,
  blocked: boolean
): boolean {
  if (!isBlockPairRule(conversationType)) {
    return false;
  }
  return otherMemberId !== undefined && blocked;
}

// The peer whose block can stop this user sending here, or undefined when there
// is no such peer. Same rule as `isHiddenByBlock`, for the write path: a send is
// refused when a block exists between the sender and the one person they are
// writing to, and a den has no such person - so a member of a den can always
// send, to a room that may well contain somebody they have blocked.
//
// The type test is delegated rather than written out. `conversation.type !== "DM"`
// was a second copy of the taxonomy `isBlockPairRule` already holds, in the one
// module whose entire purpose is to be the only place that classification lives -
// and it is the copy that matters, because a third conversation type would be
// admitted by one and refused by the other depending on which line a caller
// happened to read.
export function blockedSendPeer(
  conversation: {
    members: { userId: string }[];
    type: ConversationType;
  },
  userId: string
): string | undefined {
  if (!isBlockPairRule(conversation.type)) {
    return undefined;
  }
  return dmPeerId(conversation.members, userId);
}
