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

export function isDenRole(value: string): value is DenRole {
  return (DEN_ROLES as readonly string[]).includes(value);
}

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
