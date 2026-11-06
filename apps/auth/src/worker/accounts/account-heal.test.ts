import { describe, expect, test } from "bun:test";

import {
  CANONICAL_CREDENTIAL_ISSUER,
  planCredentialHeal,
} from "./account-heal";
import type { AccountShape } from "./account-heal";

const USER_ID = "user-1";

function account(
  partial: Partial<AccountShape> & Pick<AccountShape, "accountId" | "id">
): AccountShape {
  return {
    issuer: "",
    password: null,
    providerId: "credential",
    ...partial,
  };
}

function plan(
  accounts: AccountShape[],
  userPasswordHash: string | null = null
) {
  return planCredentialHeal({ accounts, userId: USER_ID, userPasswordHash });
}

describe("planCredentialHeal", () => {
  test("noops when the canonical row already carries the current hash", () => {
    const decision = plan(
      [
        account({
          accountId: USER_ID,
          id: "a1",
          issuer: CANONICAL_CREDENTIAL_ISSUER,
          password: "hash-current",
        }),
      ],
      "hash-current"
    );

    expect(decision.action).toBe("noop");
  });

  test("creates a canonical row from a legacy email-keyed credential row", () => {
    const decision = plan(
      [
        account({
          accountId: "person@example.com",
          id: "legacy",
          issuer: "credential",
          password: "hash-current",
        }),
      ],
      "hash-current"
    );

    expect(decision.action).toBe("create");
    expect(decision.adoptPassword).toBe("hash-current");
    expect(decision.issuer).toBe(CANONICAL_CREDENTIAL_ISSUER);
  });

  test("creates a canonical row from a legacy email-provider row", () => {
    const decision = plan(
      [
        account({
          accountId: "person@example.com",
          id: "email-row",
          issuer: "email",
          password: "hash-current",
          providerId: "email",
        }),
      ],
      "hash-current"
    );

    expect(decision.action).toBe("create");
  });

  test("adopts the password reset onto the canonical row (the production bug)", () => {
    // The exact failure: the canonical row holds the OLD hash; the reset wrote
    // the NEW hash to the email-keyed row AND to Users.passwordHash. The mirror
    // is authoritative, so the heal must adopt the NEW hash.
    const decision = plan(
      [
        account({
          accountId: USER_ID,
          id: "canonical-old",
          issuer: CANONICAL_CREDENTIAL_ISSUER,
          password: "hash-OLD",
        }),
        account({
          accountId: "person@example.com",
          id: "legacy-new",
          issuer: "credential",
          password: "hash-NEW",
        }),
      ],
      "hash-NEW"
    );

    expect(decision.action).toBe("update");
    expect(decision.adoptPassword).toBe("hash-NEW");
    expect(decision.adoptSource).toBe("user:passwordHash");
  });

  test("does not create an empty row for a pure OAuth account", () => {
    const decision = plan(
      [
        account({
          accountId: "google-sub",
          id: "google-row",
          issuer: "https://accounts.google.com",
          password: null,
          providerId: "google",
        }),
      ],
      null
    );

    expect(decision.action).toBe("noop");
    expect(decision.reason).toContain("no password-bearing source");
  });

  test("repairs a canonical row that has no password", () => {
    const decision = plan(
      [
        account({
          accountId: USER_ID,
          id: "canonical-empty",
          issuer: CANONICAL_CREDENTIAL_ISSUER,
          password: null,
        }),
        account({
          accountId: "person@example.com",
          id: "has-pw",
          issuer: "credential",
          password: "hash-legacy",
        }),
      ],
      "hash-legacy"
    );

    expect(decision.action).toBe("update");
    expect(decision.adoptPassword).toBe("hash-legacy");
  });

  test("falls back to an account hash when Users.passwordHash is absent", () => {
    // A better-auth-native write that only mirrored into the account row.
    const decision = plan(
      [
        account({
          accountId: USER_ID,
          id: "canonical-empty",
          issuer: CANONICAL_CREDENTIAL_ISSUER,
          password: null,
        }),
        account({
          accountId: "person@example.com",
          id: "has-pw",
          issuer: "credential",
          password: "hash-account",
        }),
      ],
      null
    );

    expect(decision.action).toBe("update");
    expect(decision.adoptPassword).toBe("hash-account");
    expect(decision.adoptSource).toBe("account:has-pw");
  });

  test("repairs a canonical row with an empty issuer but keeps its hash", () => {
    const decision = plan(
      [
        account({
          accountId: USER_ID,
          id: "canonical",
          issuer: "",
          password: "hash-same",
        }),
      ],
      "hash-same"
    );

    expect(decision.action).toBe("update");
    expect(decision.issuer).toBe(CANONICAL_CREDENTIAL_ISSUER);
    expect(decision.adoptPassword).toBeUndefined();
  });

  test("is stable across repeated evaluation of the healed shape", () => {
    const healed = plan(
      [
        account({
          accountId: USER_ID,
          id: "a1",
          issuer: CANONICAL_CREDENTIAL_ISSUER,
          password: "hash-current",
        }),
        account({
          accountId: "person@example.com",
          id: "legacy",
          issuer: "credential",
          password: "hash-OLD",
        }),
      ],
      "hash-current"
    );

    expect(healed.action).toBe("noop");
  });
});
