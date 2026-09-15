import { describe, expect, test } from "bun:test";

import { createCommunitySchema } from "./schemas";

const VALID = {
  accentColor: "slate",
  description: "A place for builders and tinkers.",
  mature: false,
  name: "Hackers",
  slug: "hackers",
  topics: ["technology"],
  type: "PUBLIC",
} as const;

describe("createCommunitySchema", () => {
  test("accepts a valid payload and defaults optional fields", () => {
    const parsed = createCommunitySchema.parse({
      description: VALID.description,
      name: VALID.name,
      slug: VALID.slug,
      topics: VALID.topics,
    });
    expect(parsed.accentColor).toBe("slate");
    expect(parsed.mature).toBe(false);
    expect(parsed.type).toBe("PUBLIC");
  });

  test("trims and lowercases the slug", () => {
    const parsed = createCommunitySchema.parse({
      ...VALID,
      slug: "  Hackers  ",
    });
    expect(parsed.slug).toBe("hackers");
  });

  test("rejects a short name and a long name", () => {
    expect(
      createCommunitySchema.safeParse({ ...VALID, name: "ab" }).success
    ).toBe(false);
    expect(
      createCommunitySchema.safeParse({ ...VALID, name: "a".repeat(22) })
        .success
    ).toBe(false);
  });

  test("rejects an invalid slug charset", () => {
    expect(
      createCommunitySchema.safeParse({ ...VALID, slug: "hack-ers" }).success
    ).toBe(false);
    expect(
      createCommunitySchema.safeParse({ ...VALID, slug: "hack ers" }).success
    ).toBe(false);
  });

  test("requires at least one topic and caps at five", () => {
    expect(
      createCommunitySchema.safeParse({ ...VALID, topics: [] }).success
    ).toBe(false);
    expect(
      createCommunitySchema.safeParse({
        ...VALID,
        topics: ["art", "games", "music", "sports", "food", "news"],
      }).success
    ).toBe(false);
    expect(
      createCommunitySchema.safeParse({
        ...VALID,
        topics: ["art", "games", "music", "sports", "food"],
      }).success
    ).toBe(true);
  });

  test("rejects unknown topics and accents", () => {
    expect(
      createCommunitySchema.safeParse({ ...VALID, topics: ["nope"] }).success
    ).toBe(false);
    expect(
      createCommunitySchema.safeParse({ ...VALID, accentColor: "neon" }).success
    ).toBe(false);
  });

  test("rejects an empty description", () => {
    expect(
      createCommunitySchema.safeParse({ ...VALID, description: "   " }).success
    ).toBe(false);
  });
});
