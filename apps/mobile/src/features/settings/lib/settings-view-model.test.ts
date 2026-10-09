import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SETTINGS_TAB,
  isSettingsTab,
  resolveSettingsTab,
  SETTINGS_TABS,
  settingsTabPath,
} from "./settings-tabs";
import { accountFactsFrom, withLinkedAccounts } from "./settings-view-model";

describe("resolveSettingsTab", () => {
  test("accepts every declared tab", () => {
    for (const tab of SETTINGS_TABS) {
      expect(resolveSettingsTab(tab)).toBe(tab);
    }
  });

  test("falls back for unknown, empty and missing values", () => {
    expect(resolveSettingsTab("nope")).toBe(DEFAULT_SETTINGS_TAB);
    // oxlint-disable-next-line unicorn/no-useless-undefined -- passing undefined explicitly is the case under test
    expect(resolveSettingsTab(undefined)).toBe(DEFAULT_SETTINGS_TAB);
    expect(resolveSettingsTab("")).toBe(DEFAULT_SETTINGS_TAB);
  });

  test("takes the first value of a repeated param", () => {
    expect(resolveSettingsTab(["security", "account"])).toBe("security");
  });
});

describe("isSettingsTab", () => {
  test("narrows only the declared tabs", () => {
    expect(isSettingsTab("account")).toBe(true);
    expect(isSettingsTab("Account")).toBe(false);
    expect(isSettingsTab(null)).toBe(false);
  });
});

describe("settingsTabPath", () => {
  test("carries the tab so a deep link lands on the right section", () => {
    expect(settingsTabPath("security")).toBe("/settings?tab=security");
  });
});

describe("accountFactsFrom", () => {
  test("derives nothing but a username for a signed-out viewer", () => {
    const facts = accountFactsFrom(null);
    expect(facts.username).toBe("");
    expect(facts.email).toBeNull();
    expect(facts.emailVerified).toBe(false);
    expect(facts.linkedProviders).toEqual([]);
  });

  test("prefers username over name", () => {
    expect(
      accountFactsFrom({ id: "u1", name: "Ada L", username: "ada" }).username
    ).toBe("ada");
    expect(accountFactsFrom({ id: "u1", name: "Ada L" }).username).toBe(
      "Ada L"
    );
  });

  test("collects linked provider ids", () => {
    const facts = accountFactsFrom({
      accounts: [{ providerId: "google" }, { providerId: "credential" }],
      id: "u1",
      username: "ada",
    });
    expect(facts.linkedProviders).toEqual(["google", "credential"]);
  });

  test("infers a password from a credential account", () => {
    const facts = accountFactsFrom({
      accounts: [{ providerId: "credential" }, { providerId: "google" }],
      email: "ada@example.com",
      emailVerified: true,
      id: "u1",
      username: "ada",
    });
    expect(facts.hasPassword).toBe(true);
    // Linking another provider needs both a verified email and a password.
    expect(facts.canLinkProviders).toBe(true);
  });

  test("a social-only account cannot link another provider yet", () => {
    const facts = accountFactsFrom({
      accounts: [{ providerId: "google" }],
      email: "ada@example.com",
      emailVerified: true,
      id: "u1",
      username: "ada",
    });
    expect(facts.hasPassword).toBe(false);
    expect(facts.canLinkProviders).toBe(false);
  });

  test("an unverified email blocks linking even with a password", () => {
    const facts = accountFactsFrom({
      accounts: [{ providerId: "credential" }],
      email: "ada@example.com",
      emailVerified: false,
      id: "u1",
      username: "ada",
    });
    expect(facts.canLinkProviders).toBe(false);
  });

  test("assumes a password exists when no account list is exposed", () => {
    // A false negative would show a redundant "add a password" form; a false
    // positive only hides it, so the safe default is to assume one.
    const facts = accountFactsFrom({ id: "u1", username: "ada" });
    expect(facts.hasPassword).toBe(true);
  });

  test("ignores malformed account entries rather than throwing", () => {
    const facts = accountFactsFrom({
      accounts: [null, "google", { providerId: 7 }, { providerId: "reddit" }],
      id: "u1",
      username: "ada",
    });
    expect(facts.linkedProviders).toEqual(["reddit"]);
  });
});

describe("withLinkedAccounts", () => {
  test("merges the server's account rows onto the session facts", () => {
    const facts = accountFactsFrom({
      email: "ada@example.com",
      emailVerified: true,
      id: "u1",
      username: "ada",
    });
    const merged = withLinkedAccounts(facts, {
      hasPassword: true,
      linkedProviders: ["google"],
    });
    expect(merged.hasPassword).toBe(true);
    expect(merged.linkedProviders).toEqual(["google"]);
    expect(merged.canLinkProviders).toBe(true);
  });

  test("flags a Reddit-only account with no password", () => {
    const facts = accountFactsFrom({
      email: "ada@example.com",
      emailVerified: true,
      id: "u1",
      username: "ada",
    });
    const merged = withLinkedAccounts(facts, {
      hasPassword: false,
      linkedProviders: ["reddit"],
    });
    expect(merged.hasPassword).toBe(false);
    expect(merged.hasReddit).toBe(true);
    expect(merged.canLinkProviders).toBe(false);
  });
});
