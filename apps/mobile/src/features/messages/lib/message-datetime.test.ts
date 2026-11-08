import { expect, test } from "bun:test";

import { formatMessageDateTime } from "./message-datetime";

const NOW = new Date("2026-11-07T14:30:00");

test("today and yesterday read as words with the time", () => {
  expect(formatMessageDateTime(new Date("2026-11-07T09:15:00"), NOW)).toBe(
    "Today at 9:15 AM"
  );
  expect(formatMessageDateTime(new Date("2026-11-06T18:00:00"), NOW)).toBe(
    "Yesterday at 6:00 PM"
  );
});

test("same-year omits the year, older stamps include it", () => {
  expect(formatMessageDateTime(new Date("2026-01-05T14:30:00"), NOW)).toBe(
    "Jan 5 at 2:30 PM"
  );
  expect(formatMessageDateTime(new Date("2025-01-05T14:30:00"), NOW)).toBe(
    "Jan 5, 2025 at 2:30 PM"
  );
});

test("missing and garbage values render as empty so rows skip", () => {
  expect(formatMessageDateTime(null, NOW)).toBe("");
  expect(formatMessageDateTime(undefined, NOW)).toBe("");
  expect(formatMessageDateTime("not a date", NOW)).toBe("");
});
