// Usernames that can never be claimed by a real user. "zeph" is the reserved
// handle of the platform's neutral moderation persona (see
// apps/web/src/lib/system-moderation-user.ts), so it is blocked everywhere a
// username can be created: email signup, OAuth-derived handles and any later
// username path. Matching is case-insensitive to keep the reservation airtight.
const RESERVED_USERNAMES = new Set(["zeph"]);

export function isReservedUsername(username?: string | null): boolean {
  if (!username) {
    return false;
  }
  return RESERVED_USERNAMES.has(username.trim().toLowerCase());
}

export const RESERVED_USERNAME_LIST = [...RESERVED_USERNAMES];
