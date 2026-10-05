// Den (group conversation) limits, roles, and taxonomy.
//
// Lives in @asm/db rather than the web app so the create dialog, the details
// panel, and every server route that validates a den read one source of truth.
// The bounds are duplicated as a database CHECK constraint on
// message_conversations.name, so a drift between this file and the contract
// fails loudly at write time rather than silently accepting a den the UI could
// never render.

// Discord-scale, not Instagram-scale. The ceiling is the point at which the
// fan-out of one root-key wrap per member becomes the dominant cost of a send,
// so it is a protocol limit and not a taste decision.
export const DEN_LIMITS = {
  descriptionMax: 280,
  inviteCodeLength: 12,
  // A den needs at least two people or it is a DM with extra steps, which the
  // DM path already handles with a pairKey.
  membersMax: 100,
  membersMin: 2,
  nameMax: 64,
  nameMin: 1,
  // How many retired join codes a den keeps in `message_conversation_invite_codes`,
  // which is what lets a link somebody was already given still name the den after
  // its code is rotated away.
  //
  // Five, for the shape of the problem rather than for a round number: rotation is
  // the "this code leaked" button, so a den's history of codes is a handful of
  // incidents and not a schedule. Five covers every realistic window in which a
  // shared link is still being clicked - days, not months - at a cost of five
  // twelve-character strings per den that ever had to rotate. Bounded is the whole
  // point: an unbounded archive is a slow-motion leak of secrets that grant nothing
  // the moment they are retired, and it would grow with how often somebody pressed
  // a button rather than with how many people use the product.
  retiredInviteCodeMax: 5,
} as const;

// Unambiguous alphabet for a code people retype from a screenshot. No 0/O,
// 1/l/I: every glyph here survives being read off a phone screen.
export const DEN_INVITE_CODE_ALPHABET =
  "abcdefghjkmnpqrstuvwxyz23456789" as const;

// Role model. Exactly one member is the Owner, any number may be an Elder, and
// everyone else is a Member. Those are the words a person reads; the stored
// values are OWNER, ADMIN and MEMBER, and only the display layer translates
// between them (`denRoleLabel` in the web app). The stored names stay as they
// are because renaming the enum would rewrite every row and every comparison in
// the product to change a label.
//
// A DM row carries MEMBER, which is never read: DM authorization is membership,
// not role.
//
// OWNER is deliberately absent from the assignable roles: ownership moves only by
// an explicit transfer, by leaving (which transfers it) or by dissolving the den,
// never by promotion. That keeps "the owner" a single, nameable account rather
// than a shared role.
export const DEN_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;

export type DenRole = (typeof DEN_ROLES)[number];

// Roles that may add, remove, promote, rename, rotate the invite, or dissolve a
// den. Everything a member can do, a plain member can also do by leaving.
export const DEN_MANAGEMENT_ROLES = ["OWNER", "ADMIN"] as const;

export type DenManagementRole = (typeof DEN_MANAGEMENT_ROLES)[number];

// What a durable membership log line can record, mirroring the
// `DenMembershipEventAction` enum in the contract. Kept here so the service and
// the web client share the union, and the create call's own type comes from the
// generated contract, so a divergence is a compile error rather than a row that
// stores a value no reader understands.
export const DEN_MEMBERSHIP_EVENT_ACTIONS = [
  "CREATED",
  "JOINED",
  "LEFT",
  "REMOVED",
  "PROMOTED",
  "DEMOTED",
  "OWNER_TRANSFERRED",
] as const;

export type DenMembershipEventAction =
  (typeof DEN_MEMBERSHIP_EVENT_ACTIONS)[number];

export function isDenRole(value: string): value is DenRole {
  return (DEN_ROLES as readonly string[]).includes(value);
}

// Who may put an account in a group without being asked first, mirroring the
// `GroupAddPolicy` enum in the contract.
//
// This is the CANDIDATE's setting, not a rule about who follows whom, which is
// why the enum is named for the direction it means: `FOLLOWING_ONLY` qualifies an
// adder the candidate already follows. A setting called "followers only" would
// have named the opposite list, and the bug that causes is invisible in review
// because both readings are plausible until you ask whose list it is.
//
// The default is `FOLLOWING_ONLY` and not `EVERYONE`, so an account that never
// opens Settings behaves exactly as it behaved before the setting existed.
export const GROUP_ADD_POLICIES = [
  "EVERYONE",
  "FOLLOWING_ONLY",
  "NO_DIRECT_ADDS",
] as const;

export type GroupAddPolicy = (typeof GROUP_ADD_POLICIES)[number];

export function isGroupAddPolicy(value: unknown): value is GroupAddPolicy {
  return (
    typeof value === "string" &&
    (GROUP_ADD_POLICIES as readonly string[]).includes(value)
  );
}

// Why a candidate cannot be added to a group outright, when they cannot.
//
// Two reasons, and the second is deliberately narrower than "you do not follow
// them": it is that the CANDIDATE does not follow the adder. Nobody is stopped
// for the state of their own following list, because the setting is about who is
// willing to be put in a room, not about who may do the putting.
// `NO_DIRECT_ADDS` reads as a description of them rather than a rule imposed on
// them, because they chose it - which is why the copy below is written about
// the candidate and never about the person holding the picker.
export type GroupAddRefusal = "NO_DIRECT_ADDS" | "NOT_FOLLOWING_YOU";

// The whole rule, as one pure function.
//
// Shared rather than written at each of its three call sites - the create route,
// the add route, and the picker that greys rows out - because a picker that
// disagrees with the route it is feeding produces a control that lies: either a
// row the reader can tap that the server refuses, or a dead row with nothing
// wrong with it. `candidateFollowsActor` is a fact about the edge rather than
// about the policy, so the caller answers it with one bulk query.
export function groupAddRefusal(
  policy: GroupAddPolicy,
  candidateFollowsActor: boolean
): GroupAddRefusal | null {
  if (policy === "EVERYONE") {
    return null;
  }
  if (policy === "NO_DIRECT_ADDS") {
    return "NO_DIRECT_ADDS";
  }
  return candidateFollowsActor ? null : "NOT_FOLLOWING_YOU";
}

// The cap on a ban reason.
//
// In this module rather than beside the ban queries because it is a RULE, not a query,
// and the client has to be able to hold the same one: the dialog's `maxLength` and the
// server's slice coming from different numbers is how a textarea starts rejecting input
// the server would have truncated, or the reverse - a reason that silently loses its
// tail with no indication to either side.
export const DEN_BAN_REASON_MAX = 140;

// Reads a ban reason out of an untrusted body.
//
// A type guard first and a cap second, in that order, because the two failures are
// different: a `reason` that is not a string is somebody sending the wrong shape and
// deserves a 400, while an over-long one is a well-formed note that is simply too big,
// and coercing it to "140" would store a sentence nobody wrote.
export function normalizeDenBanReason(
  value: unknown
): { ok: true; reason: string | null } | { ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, reason: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  return {
    ok: true,
    reason: trimmed.length === 0 ? null : trimmed.slice(0, DEN_BAN_REASON_MAX),
  };
}

// The route's whole sentence for a refusal.
//
// Third person, unlike the picker's row: this is an error about a proposal, and it has
// to survive being shown where the candidate is not named.
//
// Moved here from `den-group-add.ts`, which cannot be reached from a route test that
// replaces the `@asm/db` barrel - so a test standing in for `groupAddRefusalFor` had to
// restate these two sentences, and a reword in production would have left the test
// asserting its own copy and calling it a pass. Beside `GROUP_ADD_REFUSAL_COPY`, which is
// the same two rules in the second person.
export function groupAddRefusalError(refusal: GroupAddRefusal): string {
  return refusal === "NO_DIRECT_ADDS"
    ? "Some of those people don't allow being added to groups"
    : "Some of those people only let people they follow add them";
}

// The reader-facing wording for a refusal, shared so the greyed-out row in the
// picker and the error the route returns are the same sentence.
//
// Second person on purpose. The row is about the person who would be added, and
// the picker is read by the person doing the adding, so "only lets people they
// follow add them" is the fact; the reader works out who "they" is from the row
// they are looking at.
export const GROUP_ADD_REFUSAL_COPY: Record<GroupAddRefusal, string> = {
  NOT_FOLLOWING_YOU: "only lets people they follow add them",
  NO_DIRECT_ADDS: "doesn't allow being added to groups",
};

// Whether `role` may run a management route. Callers that need finer
// distinctions (only the owner may promote, or delete the den) must check the
// role directly rather than widen this helper.
export function canManageDen(role: string): boolean {
  return (DEN_MANAGEMENT_ROLES as readonly string[]).includes(role);
}

// Whether `actorRole` may act on `targetRole`. An Elder cannot kick or demote
// the owner; only the owner can. Self-action is a separate question the caller
// answers with the target's user id, because a role cannot distinguish the owner
// from any other member who happens to share the role string.
export function canManageRole(actorRole: string, targetRole: string): boolean {
  if (!canManageDen(actorRole)) {
    return false;
  }
  return targetRole !== "OWNER" || actorRole === "OWNER";
}

export const DEN_TYPES = ["DM", "DEN"] as const;

export type ConversationType = (typeof DEN_TYPES)[number];

// Normalizes a den name for storage: trimmed and collapsed to single spaces, so
// "  game   night " and "game night" are the same den and cannot both exist
// under cosmetic differences the UI would render identically.
export function normalizeDenName(raw: string): string {
  return raw.trim().replaceAll(/\s+/gu, " ");
}

// Validates a den name after normalization. Returns null when acceptable, or a
// message explaining the refusal. Kept as a string rather than a thrown error
// because every call site wants to answer with its own status code.
export function validateDenName(raw: string): string | null {
  const name = normalizeDenName(raw);
  if (name.length < DEN_LIMITS.nameMin) {
    return "Den name is required";
  }
  if (name.length > DEN_LIMITS.nameMax) {
    return `Den name must be ${DEN_LIMITS.nameMax} characters or fewer`;
  }
  return null;
}

// Same shape as validateDenName, for the optional description. An empty
// description is valid and means "no description", not "unset".
export function validateDenDescription(raw: string): string | null {
  const description = raw.trim();
  if (description.length > DEN_LIMITS.descriptionMax) {
    return `Description must be ${DEN_LIMITS.descriptionMax} characters or fewer`;
  }
  return null;
}
