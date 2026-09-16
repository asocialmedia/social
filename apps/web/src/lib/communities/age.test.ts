import { describe, expect, test } from "bun:test";

import { formatCommunityAge } from "./age";

// A fixed reference point so every boundary is exact.
const NOW = new Date("2026-06-15T12:00:00.000Z");

const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe("formatCommunityAge", () => {
  test("anything under a day reads as recently", () => {
    expect(formatCommunityAge(NOW, NOW)).toBe("Created recently");
    expect(formatCommunityAge(daysAgo(0.5), NOW)).toBe("Created recently");
  });

  test("a future date does not produce a negative age", () => {
    const future = new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000);
    expect(formatCommunityAge(future, NOW)).toBe("Created recently");
  });

  test("days are pluralised", () => {
    expect(formatCommunityAge(daysAgo(1), NOW)).toBe("Created 1 day ago");
    expect(formatCommunityAge(daysAgo(2), NOW)).toBe("Created 2 days ago");
    expect(formatCommunityAge(daysAgo(29), NOW)).toBe("Created 29 days ago");
  });

  test("days roll into months at 30", () => {
    expect(formatCommunityAge(daysAgo(30), NOW)).toBe("Created 1 month ago");
    expect(formatCommunityAge(daysAgo(90), NOW)).toBe("Created 3 months ago");
    expect(formatCommunityAge(daysAgo(364), NOW)).toBe("Created 12 months ago");
  });

  test("months roll into years at 365 days", () => {
    expect(formatCommunityAge(daysAgo(365), NOW)).toBe("Created 1 year ago");
    expect(formatCommunityAge(daysAgo(800), NOW)).toBe("Created 2 years ago");
  });

  test("accepts a string date, which is what the API payload carries", () => {
    expect(formatCommunityAge(daysAgo(5).toISOString(), NOW)).toBe(
      "Created 5 days ago"
    );
  });

  test("an unparseable date degrades instead of throwing", () => {
    expect(formatCommunityAge("not-a-date", NOW)).toBe("Created recently");
  });

  test("clock units never leak in - the label stays a sentence", () => {
    for (const days of [0, 3, 45, 900]) {
      const label = formatCommunityAge(daysAgo(days), NOW);
      expect(label.startsWith("Created ")).toBe(true);
      expect(label).not.toMatch(/\b(?:[mh]|sec|min)\b/);
    }
  });
});
