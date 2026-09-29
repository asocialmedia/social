import { describe, expect, test } from "bun:test";

import { resolveRecoveryState } from "./message-recovery-state";

describe("resolveRecoveryState", () => {
  test("reports not-set-up when no server identity exists", () => {
    expect(resolveRecoveryState({ identityExists: false })).toBe("not-set-up");
  });

  test("reports enabled when the server identity exists", () => {
    // Recovery is deterministic from the stored row, so the row's existence is
    // the whole state: there is no device-local secret to check.
    expect(resolveRecoveryState({ identityExists: true })).toBe("enabled");
  });
});
