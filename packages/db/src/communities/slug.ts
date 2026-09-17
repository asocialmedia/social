// Community slug rules. A slug is the immutable /a/{slug} address of a
// community, so it is validated once at creation and never edited afterwards.
// Matching is case-insensitive at the route layer; storage is always lowercase.

import { COMMUNITY_LIMITS } from "./constants";

const SLUG_PATTERN = /^[a-z0-9_]+$/;

// Slugs that would collide with real routes or read as platform-owned. Kept
// separate from user reserved names because the surfaces differ.
const RESERVED_COMMUNITY_SLUGS = new Set([
  "admin",
  "all",
  "api",
  "a",
  "c",
  "comm",
  "communities",
  "community",
  "create",
  "explore",
  "feed",
  "help",
  "home",
  "login",
  "me",
  "mod",
  "moderator",
  "new",
  "official",
  "popular",
  "post",
  "posts",
  "privacy",
  "r",
  "search",
  "settings",
  "signup",
  "support",
  "system",
  "terms",
  "trending",
  "u",
  "user",
  "users",
  "zeph",
]);

export function normalizeCommunitySlug(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isReservedCommunitySlug(slug: string): boolean {
  return RESERVED_COMMUNITY_SLUGS.has(normalizeCommunitySlug(slug));
}

export function isValidCommunitySlug(raw: string): boolean {
  const slug = normalizeCommunitySlug(raw);
  if (
    slug.length < COMMUNITY_LIMITS.slugMin ||
    slug.length > COMMUNITY_LIMITS.slugMax
  ) {
    return false;
  }
  if (!SLUG_PATTERN.test(slug)) {
    return false;
  }
  return !isReservedCommunitySlug(slug);
}

// Turns a display name into a candidate slug. Falls back to an empty string so
// the caller can prompt the user instead of shipping a broken address.
//
// The edge trim is an explicit index scan rather than `/^_+|_+$/`. The
// alternation of two anchored `_+` quantifiers is a polynomial-backtracking
// pattern (CodeQL: "polynomial regular expression used on uncontrolled data"):
// an interior run of underscores is matched by `_+$`, whose anchor then fails,
// so the engine retries from every position in the run - quadratic in the run
// length. Walking the ends with two pointers is linear and cannot backtrack.
export function slugifyCommunityName(name: string): string {
  const collapsed = normalizeCommunitySlug(name).replaceAll(
    /[^a-z0-9_]+/g,
    "_"
  );

  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === "_") {
    start += 1;
  }
  while (end > start && collapsed[end - 1] === "_") {
    end -= 1;
  }

  return collapsed.slice(start, end).slice(0, COMMUNITY_LIMITS.slugMax);
}

export const RESERVED_COMMUNITY_SLUG_LIST = [...RESERVED_COMMUNITY_SLUGS];
