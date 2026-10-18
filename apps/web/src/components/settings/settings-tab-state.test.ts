import { describe, expect, test } from "bun:test";

import {
  adjacentSettingsTab,
  getSettingsTab,
  isSettingsTab,
} from "./settings-tab-state";

describe("settings tab state", () => {
  test("restores a valid tab from the URL", () => {
    expect(getSettingsTab(new URLSearchParams("tab=security"))).toBe(
      "security"
    );
  });

  test("keeps OAuth-link callback feedback on the Account tab", () => {
    expect(getSettingsTab(new URLSearchParams("account_success=google"))).toBe(
      "account"
    );
  });

  test("accepts every tab the settings page offers, including Privacy", () => {
    // Deep links and the settings search both land on a tab by name, so a tab
    // missing here is a section the reader cannot be linked to. The list is
    // written out rather than imported from the component, because the component
    // is what this is checking.
    for (const tab of [
      "profile",
      "account",
      "privacy",
      "security",
      "personalization",
    ]) {
      expect(getSettingsTab(new URLSearchParams(`tab=${tab}`))).toBe(tab);
      expect(isSettingsTab(tab)).toBe(true);
    }
  });

  test("swipes follow the visible settings tabs in both directions", () => {
    expect(adjacentSettingsTab("profile", 1)).toBe("account");
    expect(adjacentSettingsTab("account", 1)).toBe("privacy");
    expect(adjacentSettingsTab("privacy", 1)).toBe("security");
    expect(adjacentSettingsTab("security", 1)).toBe("personalization");
    expect(adjacentSettingsTab("personalization", -1)).toBe("security");
    expect(adjacentSettingsTab("security", -1)).toBe("privacy");
    expect(adjacentSettingsTab("privacy", -1)).toBe("account");
    expect(adjacentSettingsTab("account", -1)).toBe("profile");
  });

  test("swipes stop at the first and last settings tabs", () => {
    expect(adjacentSettingsTab("profile", -1)).toBeNull();
    expect(adjacentSettingsTab("personalization", 1)).toBe("network");
    expect(adjacentSettingsTab("network", 1)).toBeNull();
  });

  test("falls back safely for missing or untrusted tab values", () => {
    expect(getSettingsTab(new URLSearchParams())).toBe("profile");
    expect(getSettingsTab(new URLSearchParams("tab=unknown"))).toBe("profile");
    expect(isSettingsTab("security")).toBe(true);
    expect(isSettingsTab("unknown")).toBe(false);
  });
});
