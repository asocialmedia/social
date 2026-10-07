// How a den is NAMED, everywhere the app has to call one.
//
// A den has a `name` column, but a den can be created before anybody thinks to
// name it and a rename can leave the column null, so every surface that labels a
// conversation needs the same fallback. Putting it here rather than in each
// component is the point: the list row, the details header and the rail all read
// one answer, so "the den with no name" cannot render as three different
// strings depending on which pane you are looking at.
//
// Also here, because it is the same question asked about the list: the All /
// DMs / Dens filter, and the stacked avatar a den shows instead of one face.

import type { ConversationType } from "@asm/db/messages/dens";

// The member shape the label helpers read. Narrower than MessageSender on
// purpose: a label is a display name and an avatar, and a helper that could
// reach for a key or a community role would be an invitation to depend on one.
export interface DenLabelMember {
  avatarUrl: string | null;
  displayName: string;
  id: string;
  username: string;
}

export interface DenLabelConversation {
  members: DenLabelMember[];
  name?: string | null;
  type: ConversationType;
}

// The filter tabs over the conversation list. `type` is the conversation column's
// own value, so the tab set and the discriminator can never disagree.
export const DEN_LIST_FILTERS = ["ALL", "DM", "DEN"] as const;

export type DenListFilter = (typeof DEN_LIST_FILTERS)[number];

export function isDenListFilter(value: string): value is DenListFilter {
  return (DEN_LIST_FILTERS as readonly string[]).includes(value);
}

// Joins names the way a sentence would: "Ada, Grace and 3 others". The "and"
// form is only worth it for two, and three names plus a count is the ceiling,
// because a den can hold a hundred and a row is not a roster.
const FALLBACK_NAMES_MAX = 3;

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  const head = names.slice(0, FALLBACK_NAMES_MAX - 1).join(", ");
  const extra = names.length - (FALLBACK_NAMES_MAX - 1);
  return `${head} and ${extra} more`;
}

// The people a den is NAMED after when it has no name of its own: everyone
// except the reader. Excluding the reader matches what a DM row does with the
// same roster (the peer, never yourself), and it is what makes the fallback read
// as the conversation rather than as a membership list.
export function denFallbackNames(
  members: readonly DenLabelMember[],
  myUserId: string
): string[] {
  return members
    .filter((member) => member.id !== myUserId)
    .map((member) => member.displayName || member.username)
    .filter((name) => name.length > 0);
}

// What to call a den. `name` wins when it holds anything after trimming, because
// a name of spaces is no name at all. Failing that, the member names. Failing
// that, "Den", so the row always has something to render.
export function denDisplayName(
  conversation: DenLabelConversation,
  myUserId: string
): string {
  const named = conversation.name?.trim();
  if (named) {
    return named;
  }
  const others = denFallbackNames(conversation.members, myUserId);
  if (others.length === 0) {
    return "Den";
  }
  // The whole list, not a pre-sliced one: the cap is inside joinNames, which is
  // what knows how many names fit and how many there are left over to count.
  return joinNames(others);
}

// What to call a DM, which has no name column at all: the peer, then their
// username, then "Conversation" for the moment before the roster resolves.
//
// The DM branch lives here rather than in each surface because a den falls back
// to member names and the two must not read as the same string when a caller
// has not branched on `type` yet.
export function conversationDisplayName(
  conversation: DenLabelConversation,
  myUserId: string
): string {
  if (conversation.type === "DEN") {
    return denDisplayName(conversation, myUserId);
  }
  const peer = conversation.members.find((member) => member.id !== myUserId);
  return peer?.displayName || peer?.username || "Conversation";
}

// The list row's second line.
//
// A DM's is just what was said, because the row's heading already says who said
// it. A den's is prefixed with WHO said it, because the heading says where and
// the preview is the only place the byline can live. The reader's own message
// keeps the prefix `conversationPreviewText` already gave it ("You: ..."), so
// this must not add a second one.
//
// Returns the input preview untouched when there is nothing to attribute, which
// is what keeps a not-yet-decrypted row reading as empty rather than as
// "Ada: ".
export function denPreviewLine(input: {
  conversation: DenLabelConversation;
  lastSenderId: string | null;
  myUserId: string;
  preview: string;
}): string {
  const { conversation, lastSenderId, myUserId, preview } = input;
  if (conversation.type !== "DEN" || preview.length === 0) {
    return preview;
  }
  // The DM contract, not a den one: a reader's own message is already labelled
  // and a second "You:" would read as a stutter.
  if (lastSenderId === myUserId || lastSenderId === null) {
    return preview;
  }
  const sender = conversation.members.find(
    (member) => member.id === lastSenderId
  );
  const name = sender?.displayName || sender?.username;
  if (!name) {
    return preview;
  }
  return `${name}: ${preview}`;
}

// The faces a den's stacked avatar draws, when it has no image of its own.
//
// All members (including the reader), capped at three by default and ordered
// by role then by the order the roster arrived in, so the owner's face leads.
// The cap is a layout decision (four overlapping squircles stop reading as a group)
// rather than a membership one; the roster itself is a separate read.
export const DEN_AVATAR_FACES_MAX = 3;

const ROLE_ORDER: Record<string, number> = {
  ADMIN: 1,
  MEMBER: 2,
  OWNER: 0,
};

export function denAvatarFaces(
  members: readonly (DenLabelMember & { role?: string | null })[],
  _myUserId?: string,
  limit: number = DEN_AVATAR_FACES_MAX
): DenLabelMember[] {
  return members
    .map((member, index) => ({ index, member }))
    .toSorted((left, right) => {
      const rank =
        (ROLE_ORDER[left.member.role ?? "MEMBER"] ?? 2) -
        (ROLE_ORDER[right.member.role ?? "MEMBER"] ?? 2);
      // The original index breaks ties so two members of the same role keep the
      // order the server sent, which is join order.
      if (rank !== 0) {
        return rank;
      }
      return left.index - right.index;
    })
    .slice(0, Math.max(0, limit))
    .map(({ member }) => member);
}

// "1 member", "12 members". Spelled out rather than abbreviated because it is
// read aloud by a screen reader as often as it is scanned.
export function denMemberCountLabel(count: number): string {
  const safe = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return `${safe} ${safe === 1 ? "member" : "members"}`;
}

// The All / DMs / Dens filter over the conversation list. The unread badge and
// the muted-shows-zero rule are applied by the server per row and are untouched
// by this: filtering hides a row, it does not recompute what the row says.
export function filterConversationsByType<
  T extends { conversation: { type: ConversationType } },
>(items: readonly T[], filter: DenListFilter): T[] {
  if (filter === "ALL") {
    return [...items];
  }
  return items.filter((item) => item.conversation.type === filter);
}

// The tab strip's per-filter counts, computed from the same array the rows are
// rendered from rather than from a second query, so a badge on a tab and the rows
// under it are one read.
export function countConversationsByType(
  items: readonly { conversation: { type: ConversationType } }[]
): Record<DenListFilter, number> {
  const tally: Record<DenListFilter, number> = { ALL: 0, DEN: 0, DM: 0 };
  for (const item of items) {
    tally.ALL += 1;
    tally[item.conversation.type] += 1;
  }
  return tally;
}

// How a conversation links to a den's own preview surface. The den row in the
// list points at the thread like any other row; this is the same conversation
// id in the shape the details panel and the header take.
export function denConversationPath(conversationId: string): string {
  return `/messages?c=${encodeURIComponent(conversationId)}`;
}
