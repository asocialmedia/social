// Den name/description/ban-reason rules for the native create/edit/ban forms.
// Mirrors apps/web via packages/db/src/messages/dens/policies.ts
// (DEN_LIMITS, DEN_BAN_REASON_MAX, normalizeDenName, validateDenName,
// validateDenDescription, normalizeDenBanReason). Mobile never imports @asm/db
// (server-side Prisma), so the rule is mirrored here; the server still
// enforces it and slices over-long reasons.

export const DEN_LIMITS = {
  descriptionMax: 280,
  membersMax: 100,
  membersMin: 2,
  nameMax: 64,
  nameMin: 1,
} as const;

// The cap on a ban reason. The dialog's maxLength and the server's slice come
// from the same number so a note the server would truncate is never rejected
// by the form, and a note the form accepts never silently loses its tail.
export const DEN_BAN_REASON_MAX = 140;

export const DEN_BAN_REASON_LABEL =
  "Reason (optional) — only owners and Elders see this";

export const DEN_BAN_REASON_PLACEHOLDER = "Anything the next owner should know";

// Normalizes a den name for storage: trimmed and collapsed to single spaces,
// so "  game   night " and "game night" are the same den.
export function normalizeDenName(raw: string): string {
  return raw.trim().replaceAll(/\s+/gu, " ");
}

// Validates a den name after normalization. Null when acceptable, else the
// refusal message.
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

// Reads a ban reason out of an untrusted form value. Empty trims to null;
// over-long notes are sliced to the cap like the server does.
export function normalizeDenBanReason(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, DEN_BAN_REASON_MAX);
}
