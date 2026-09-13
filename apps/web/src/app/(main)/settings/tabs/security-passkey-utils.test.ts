import { describe, expect, test } from "bun:test";

import { requiresFreshSession } from "./security-passkey-utils";

describe("requiresFreshSession", () => {
  test("recognizes Better Auth's fresh-session response", () => {
    expect(
      requiresFreshSession({ message: "Session is not fresh", status: 403 })
    ).toBe(true);
  });

  test("does not hide unrelated passkey errors behind re-authentication", () => {
    expect(
      requiresFreshSession({
        message: "This credential is already registered",
        status: 400,
      })
    ).toBe(false);
  });
});
