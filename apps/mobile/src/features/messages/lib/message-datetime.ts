// Full, unambiguous timestamps for the message options sheet ("Today at 2:30
// PM", "Yesterday at 2:30 PM", "Jan 5 at 2:30 PM", "Jan 5, 2026 at 2:30 PM").
// Mirrors web `formatMessageDateTime` (`apps/web/src/lib/utils.ts`), built on
// Intl instead of date-fns so the messages feature adds no dependency.
export function formatMessageDateTime(
  value: Date | string | number | null | undefined,
  now: Date = new Date()
): string {
  if (value === null || value === undefined) {
    return "";
  }
  const date =
    typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : value;
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: true,
    minute: "2-digit",
  }).format(date);
  if (isSameDay(date, now)) {
    return `Today at ${time}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return `Yesterday at ${time}`;
  }
  const monthDay = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(date);
  if (date.getFullYear() === now.getFullYear()) {
    return `${monthDay} at ${time}`;
  }
  return `${monthDay}, ${date.getFullYear()} at ${time}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
