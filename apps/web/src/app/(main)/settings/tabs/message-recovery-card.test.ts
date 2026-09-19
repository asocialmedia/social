import { describe, expect, test } from "bun:test";

import { resolveRecoveryState } from "./message-recovery-state";

describe("resolveRecoveryState", () => {
  test("reports not-set-up when no server identity exists", () => {
    expect(
      resolveRecoveryState({ deviceSecret: null, identityExists: false })
    ).toBe("not-set-up");
    // A leftover secret without an identity is still not set up: the secret
    // cannot decrypt anything until an identity row exists.
    expect(
      resolveRecoveryState({ deviceSecret: "s", identityExists: false })
    ).toBe("not-set-up");
  });

  test("is recoverable when the identity and this device's secret both exist", () => {
    expect(
      resolveRecoveryState({ deviceSecret: "secret", identityExists: true })
    ).toBe("recoverable");
  });

  test("is locked when the identity exists but this device has no secret", () => {
    expect(
      resolveRecoveryState({ deviceSecret: null, identityExists: true })
    ).toBe("locked");
  });
});
