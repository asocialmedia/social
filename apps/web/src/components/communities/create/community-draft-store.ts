"use client";

// Refresh-safe draft for the create-community wizard, kept in sessionStorage:
// it survives a reload but dies with the tab, which is the right lifetime for a
// half-filled form. Mirrors the comment-draft-store's approach (guarded access,
// tolerant parsing, silent failure on quota/denied storage).
//
// File objects cannot be serialized, so imagery is uploaded the moment it is
// chosen (the same upload-on-select the post composer uses) and only the
// resulting media id is stored. The preview then reads /api/media/{id}, which
// the owner may access while the row is still an unlinked draft.

export interface CommunityDraft {
  accentColor: string;
  // Media ids from uploads triggered at selection time. Null when unset.
  avatarMediaId: string | null;
  bannerMediaId: string | null;
  description: string;
  mature: boolean;
  name: string;
  slug: string;
  slugTouched: boolean;
  step: number;
  topics: string[];
  type: "PUBLIC" | "RESTRICTED" | "PRIVATE";
}

const DRAFT_KEY = "community-draft:new";

// Which stored fields are worth restoring from. Kept next to the type so a new
// field cannot be added and silently dropped on read.
function coerce(raw: unknown): CommunityDraft | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Partial<CommunityDraft>;
  if (typeof value.name !== "string") {
    return null;
  }
  const step = Number.isInteger(value.step) ? (value.step as number) : 0;
  return {
    accentColor:
      typeof value.accentColor === "string" ? value.accentColor : "slate",
    avatarMediaId:
      typeof value.avatarMediaId === "string" ? value.avatarMediaId : null,
    bannerMediaId:
      typeof value.bannerMediaId === "string" ? value.bannerMediaId : null,
    description: typeof value.description === "string" ? value.description : "",
    mature: value.mature === true,
    name: value.name,
    slug: typeof value.slug === "string" ? value.slug : "",
    slugTouched: value.slugTouched === true,
    // Clamp so a stale step beyond the current wizard cannot strand the user.
    step: Math.min(Math.max(step, 0), 4),
    topics: Array.isArray(value.topics)
      ? value.topics.filter((t): t is string => typeof t === "string")
      : [],
    type:
      value.type === "RESTRICTED" || value.type === "PRIVATE"
        ? value.type
        : "PUBLIC",
  };
}

export function getCommunityDraft(): CommunityDraft | null {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return null;
  }
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? coerce(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveCommunityDraft(draft: CommunityDraft): void {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage full or denied; the wizard still works, it just will not survive
    // a reload.
  }
}

export function clearCommunityDraft(): void {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore.
  }
}

// Whether a draft represents real work worth resuming. An untouched wizard
// stores a default-shaped draft, and silently reopening the dialog for that
// would be noise rather than help.
export function hasCommunityDraftProgress(draft: CommunityDraft): boolean {
  return (
    draft.step > 0 ||
    draft.name.trim().length > 0 ||
    draft.slug.trim().length > 0 ||
    draft.description.trim().length > 0 ||
    draft.topics.length > 0 ||
    Boolean(draft.avatarMediaId) ||
    Boolean(draft.bannerMediaId)
  );
}
