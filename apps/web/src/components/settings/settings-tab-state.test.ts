import { describe, expect, test } from "bun:test";

import { getSettingsTab, isSettingsTab } from "./settings-tab-state";

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

  test("falls back safely for missing or untrusted tab values", () => {
    expect(getSettingsTab(new URLSearchParams())).toBe("profile");
    expect(getSettingsTab(new URLSearchParams("tab=unknown"))).toBe("profile");
    expect(isSettingsTab("security")).toBe(true);
    expect(isSettingsTab("unknown")).toBe(false);
  });
});
