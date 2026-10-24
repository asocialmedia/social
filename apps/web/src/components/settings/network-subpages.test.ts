import { describe, expect, it } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";

import {
  getNetworkSubpage,
  isNetworkSubpage,
  NETWORK_SUBPAGES,
  networkSubpageEntry,
  networkSubpageForSection,
  networkSubpageSummary,
  networkSubpageTitle,
} from "./network-subpages";

describe("network subpages", () => {
  it("maps every searchable section onto the subpage that owns it", () => {
    expect(networkSubpageForSection("settings-network-profiles")).toBe(
      "profiles"
    );
    expect(networkSubpageForSection("settings-network-interests")).toBe(
      "content"
    );
    expect(networkSubpageForSection("settings-network-explicit")).toBe(
      "moderation"
    );
    expect(networkSubpageForSection("settings-network-avoid")).toBe(
      "moderation"
    );
    expect(networkSubpageForSection("settings-network-region")).toBe(
      "languages"
    );
    expect(networkSubpageForSection("settings-appearance")).toBeNull();
  });

  it("reads the open subpage from the URL and rejects anything else", () => {
    expect(getNetworkSubpage(new URLSearchParams("section=content"))).toBe(
      "content"
    );
    expect(getNetworkSubpage(new URLSearchParams("section=languages"))).toBe(
      "languages"
    );
    // The hub itself is the absence of a section.
    expect(getNetworkSubpage(new URLSearchParams("tab=network"))).toBeNull();
    expect(getNetworkSubpage(new URLSearchParams("section=nope"))).toBeNull();
    expect(isNetworkSubpage("moderation")).toBe(true);
    expect(isNetworkSubpage("nope")).toBe(false);
  });

  it("gives each subpage a title for the document title and the header", () => {
    expect(networkSubpageTitle("profiles")).toBe("Profiles");
    expect(networkSubpageTitle("content")).toBe("Content & media");
    expect(networkSubpageTitle("moderation")).toBe(
      "Moderation & content filters"
    );
    expect(networkSubpageTitle("languages")).toBe("Languages");
  });

  it("lists the hub entries in order, each with a description and icon", () => {
    expect(NETWORK_SUBPAGES.map((entry) => entry.title)).toEqual([
      "Profiles",
      "Content & media",
      "Moderation & content filters",
      "Languages",
    ]);
    for (const entry of NETWORK_SUBPAGES) {
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.icon).toBeDefined();
      expect(networkSubpageEntry(entry.id)).toBe(entry);
    }
  });

  it("summarises the live preferences per subpage", () => {
    const preferences = defaultNetworkPreferences();
    expect(networkSubpageSummary("profiles", preferences, "Everyday")).toBe(
      "1 profile · Everyday active"
    );
    expect(networkSubpageSummary("content", preferences, "Everyday")).toBe(
      "0 of 32 interests"
    );
    expect(networkSubpageSummary("moderation", preferences, "Everyday")).toBe(
      "18+ hidden · 0 topics avoided"
    );
    expect(networkSubpageSummary("languages", preferences, "Everyday")).toBe(
      "Device language · Device region"
    );
    expect(
      networkSubpageSummary(
        "moderation",
        {
          ...preferences,
          avoidedTopics: ["furry"],
          showExplicitContent: true,
        },
        "Everyday"
      )
    ).toBe("18+ shown · 1 topic avoided");
  });
});
