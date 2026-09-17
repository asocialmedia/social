// Human-readable age of a community, for the discovery card's stat row.
//
// Deliberately separate from `formatRelativeDate` in lib/utils: that one is
// tuned for post timestamps and returns terse clock units ("5m", "3h"), which
// read as "how long ago did this happen" rather than "how established is this".
// A community card wants the opposite - a short sentence that stays legible for
// years - so the tiers below trade precision for wording, and the clock units
// never appear.
//
// `now` is injectable so the output is deterministic in tests.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// Calendar-ish approximations, which is all this label needs: the exact
// boundary between "29 days ago" and "1 month ago" is not meaningful to a
// reader scanning a directory card.
const MONTH_DAYS = 30;
const YEAR_DAYS = 365;

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

// Returns e.g. "Created recently", "Created 12 days ago", "Created 2 months
// ago", "Created 3 years ago". Always prefixed with "Created" to match the
// community detail page's own "Created <date>" line.
export function formatCommunityAge(
  createdAt: Date | string | number,
  now: Date | number = new Date()
): string {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const nowMs = now instanceof Date ? now.getTime() : now;

  const createdMs = created.getTime();
  if (Number.isNaN(createdMs)) {
    return "Created recently";
  }

  const elapsedMs = nowMs - createdMs;
  // A clock skew or a future date should never surface as "Created -3 days ago".
  if (elapsedMs < DAY_MS) {
    return "Created recently";
  }

  const days = Math.floor(elapsedMs / DAY_MS);
  if (days < MONTH_DAYS) {
    return `Created ${plural(days, "day")}`;
  }
  // The tier is chosen from days, not from the derived month count. Deciding
  // months first splits 360-364 days into "12 months" and then computes
  // floor(364 / 365) = 0 years for the remainder of that gap, which surfaced as
  // "Created 0 years ago".
  if (days < YEAR_DAYS) {
    return `Created ${plural(Math.floor(days / MONTH_DAYS), "month")}`;
  }

  return `Created ${plural(Math.floor(days / YEAR_DAYS), "year")}`;
}
