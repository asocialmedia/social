import { describe, expect, test } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";

import {
  describeLanguage,
  describeRegion,
  isNetworkSubpage,
  networkSubpageForSection,
  networkSubpageSummary,
  networkSubpageTitle,
} from "./network-subpages";

describe("network subpages", () => {
  test("resolves every settings section to its subpage", () => {
    expect(networkSubpageForSection("settings-network-profiles")).toBe(
      "profiles"
    );
    expect(networkSubpageForSection("settings-network-interests")).toBe(
      "content"
    );
    expect(networkSubpageForSection("settings-network-activity")).toBe(
      "content"
    );
    expect(networkSubpageForSection("settings-network-connections")).toBe(
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
    expect(networkSubpageForSection("settings-network")).toBeNull();
  });

  test("guards the subpage set", () => {
    expect(isNetworkSubpage("content")).toBe(true);
    expect(isNetworkSubpage("hub")).toBe(false);
    expect(networkSubpageTitle("moderation")).toBe(
      "Moderation & content filters"
    );
  });

  test("summarises the live preferences per subpage", () => {
    const preferences = {
      ...defaultNetworkPreferences(),
      avoidedTopics: ["a", "b"],
      showExplicitContent: true,
    };
    expect(networkSubpageSummary("profiles", preferences, "Everyday")).toBe(
      "1 profile · Everyday active"
    );
    expect(networkSubpageSummary("content", preferences, "Everyday")).toBe(
      "0 of 32 interests"
    );
    expect(networkSubpageSummary("moderation", preferences, "Everyday")).toBe(
      "18+ shown · 2 topics avoided"
    );
    expect(
      networkSubpageSummary("languages", preferences, "Everyday")
    ).toContain("Device region");
  });

  test("names device and unset languages and regions", () => {
    expect(describeLanguage("auto")).toBe("Device language");
    expect(describeLanguage("all")).toBe("All languages");
    expect(describeLanguage("xx-not-a-language")).toBe("xx-not-a-language");
    expect(describeRegion("auto")).toBe("Device region");
    expect(describeRegion("all")).toBe("No region");
  });
});
