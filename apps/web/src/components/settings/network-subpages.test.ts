import { describe, expect, it } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";

import {
  NETWORK_SUBPAGES,
  networkSubpageEntry,
  networkSubpageForSection,
  networkSubpageSummary,
  readRequestedNetworkSubpage,
  requestNetworkSubpage,
  subscribeNetworkSubpage,
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

  it("notifies subscribers only when the requested subpage changes", () => {
    requestNetworkSubpage(null);
    let calls = 0;
    const unsubscribe = subscribeNetworkSubpage(() => {
      calls += 1;
    });
    requestNetworkSubpage("content");
    expect(readRequestedNetworkSubpage()).toBe("content");
    expect(calls).toBe(1);
    requestNetworkSubpage("content");
    expect(calls).toBe(1);
    requestNetworkSubpage(null);
    expect(readRequestedNetworkSubpage()).toBeNull();
    expect(calls).toBe(2);
    unsubscribe();
    requestNetworkSubpage("languages");
    expect(calls).toBe(2);
    requestNetworkSubpage(null);
  });
});
