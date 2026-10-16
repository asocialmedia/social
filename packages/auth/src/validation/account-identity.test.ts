import { expect, test } from "bun:test";

import {
  accountLinkErrorMessage,
  hasCredentialPassword,
  hasLinkedProvider,
  recoveryEmail,
} from "./account-identity";

test("Reddit placeholder identity never counts as a recovery mailbox", () => {
  expect(recoveryEmail("abc@reddit.placeholder.invalid")).toBeNull();
  expect(recoveryEmail("abc@reddit.local")).toBeNull();
  expect(recoveryEmail(null)).toBeNull();
  expect(recoveryEmail(" Person@Example.com ")).toBe("Person@Example.com");
});

test("a usable password requires a nonempty canonical credential", () => {
  expect(
    hasCredentialPassword("user", [
      { accountId: "user", password: "hash", providerId: "credential" },
    ])
  ).toBe(true);
  expect(
    hasCredentialPassword("user", [
      {
        accountId: "email@example.com",
        password: "hash",
        providerId: "credential",
      },
    ])
  ).toBe(false);
  expect(
    hasCredentialPassword("user", [
      { accountId: "user", password: null, providerId: "credential" },
    ])
  ).toBe(false);
  expect(
    hasCredentialPassword("user", [
      { accountId: "user", password: "hash", providerId: "google" },
    ])
  ).toBe(false);
});

test("callback success is checked against an actual account list", () => {
  expect(hasLinkedProvider([{ providerId: "google" }], "reddit")).toBe(false);
  expect(hasLinkedProvider([{ providerId: "reddit" }], "reddit")).toBe(true);
  expect(hasLinkedProvider({ providerId: "reddit" }, "reddit")).toBe(false);
  expect(hasLinkedProvider([null, 1, { providerId: 7 }], "reddit")).toBe(false);
});

test("ownership conflicts and last-method errors have actionable shared copy", () => {
  expect(accountLinkErrorMessage("SOCIAL_ACCOUNT_ALREADY_LINKED")).toContain(
    "another ASM account"
  );
  expect(
    accountLinkErrorMessage("account_already_linked_to_different_user")
  ).toContain("another ASM account");
  expect(accountLinkErrorMessage("cannot_unlink_last_method")).toContain(
    "working sign-in method"
  );
});
