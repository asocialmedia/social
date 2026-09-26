import { describe, expect, test } from "bun:test";

import {
  COMMUNITY_ACCENTS,
  COMMUNITY_TOPICS,
  canAddTopic,
  communitySlug,
  emptyCommunityDraft,
  validateCommunityDraft,
} from "./community-create-contract";
import type { CommunityDraft } from "./community-create-contract";

function draft(overrides: Partial<CommunityDraft> = {}): CommunityDraft {
  return {
    ...emptyCommunityDraft(),
    description: "A place for builders and tinkers.",
    name: "Hackers",
    slug: "hackers",
    topics: ["technology"],
    ...overrides,
  };
}

describe("communitySlug", () => {
  test("turns a name into an address the server will accept", () => {
    expect(communitySlug("Hackers")).toBe("hackers");
    expect(communitySlug("  Web  Devs  ")).toBe("web_devs");
    expect(communitySlug("Rust & Zig")).toBe("rust_zig");
  });

  test("underscores, not hyphens, because the schema only allows the former", () => {
    expect(communitySlug("a-b")).toBe("a_b");
  });

  test("returns empty when the name cannot make a legal address", () => {
    expect(communitySlug("ab")).toBe("");
    expect(communitySlug("!!!")).toBe("");
    expect(communitySlug("a".repeat(22))).toBe("");
  });
});

describe("validateCommunityDraft", () => {
  test("accepts a complete draft", () => {
    expect(validateCommunityDraft(draft())).toBeNull();
  });

  test("reports the same limits the server enforces", () => {
    expect(validateCommunityDraft(draft({ name: "ab" }))).toContain(
      "at least 3"
    );
    expect(validateCommunityDraft(draft({ name: "a".repeat(22) }))).toContain(
      "at most 21"
    );
    expect(validateCommunityDraft(draft({ description: "  " }))).toContain(
      "Add a description"
    );
    expect(
      validateCommunityDraft(draft({ description: "x".repeat(501) }))
    ).toContain("at most 500");
    expect(validateCommunityDraft(draft({ topics: [] }))).toContain(
      "at least one topic"
    );
    expect(
      validateCommunityDraft(
        draft({
          topics: ["art", "games", "music", "sports", "food", "news"],
        })
      )
    ).toContain("at most 5");
  });

  test("a name that cannot make an address is caught before submitting", () => {
    expect(validateCommunityDraft(draft({ name: "ab", slug: "" }))).toContain(
      "at least 3"
    );
    expect(validateCommunityDraft(draft({ slug: "" }))).toContain("3 to 21");
  });
});

describe("canAddTopic", () => {
  test("stops accepting new topics at the cap but allows removing one", () => {
    const full = ["art", "games", "music", "sports", "food"] as const;
    expect(canAddTopic(full, "news")).toBe(false);
    // A topic already chosen is always interactive, so it can be toggled off.
    expect(canAddTopic(full, "art")).toBe(true);
  });
});

describe("contract mirrors", () => {
  test("exposes the server's topic and accent keys", () => {
    expect(COMMUNITY_TOPICS).toContain("technology");
    expect(COMMUNITY_TOPICS).toContain("adult");
    expect(COMMUNITY_ACCENTS).toContain("ember");
    expect(COMMUNITY_ACCENTS).toContain("slate");
  });
});
