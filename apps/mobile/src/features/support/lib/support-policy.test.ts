import { describe, expect, test } from "bun:test";

import {
  compareVersions,
  evaluateSupport,
  nextSupportState,
  parseVersion,
} from "./support-policy";
import type { SupportGateState } from "./support-policy";

describe("parseVersion", () => {
  test("accepts a strict semver", () => {
    expect(parseVersion("1.2.3")).toBe("1.2.3");
    expect(parseVersion(" 0.1.21 ")).toBe("0.1.21");
  });

  test("refuses anything that is not a three-part semver", () => {
    // A floor is compared numerically, so a partial or non-numeric value would
    // compare as garbage - and an unparseable answer must never be the thing
    // that blocks a user's app.
    for (const value of ["1.2", "v1.2.3", "latest", "", "1.2.3-beta", null]) {
      expect(parseVersion(value)).toBeNull();
    }
  });
});

describe("compareVersions", () => {
  test("orders by each part, most significant first", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareVersions("1.1.0", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });
});

describe("evaluateSupport", () => {
  test("retires a build below the floor", () => {
    expect(evaluateSupport("0.1.20", { minimumSupported: "0.1.21" })).toBe(
      "unsupported"
    );
  });

  test("keeps a build at or above the floor", () => {
    // A build one version behind the newest release is supported; only the
    // floor retires, never "is there something newer".
    expect(evaluateSupport("0.1.21", { minimumSupported: "0.1.21" })).toBe(
      "supported"
    );
    expect(evaluateSupport("1.0.0", { minimumSupported: "0.1.21" })).toBe(
      "supported"
    );
  });

  test("supports everything when no floor is configured", () => {
    expect(evaluateSupport("0.0.1", { minimumSupported: null })).toBe(
      "no-policy"
    );
  });

  test("treats an unparseable floor as no floor at all", () => {
    // A typo in a server-side variable must not be able to lock out every
    // installed copy of the app.
    expect(evaluateSupport("0.0.1", { minimumSupported: "v1" })).toBe(
      "no-policy"
    );
  });

  test("an unreadable build version is never treated as unsupported", () => {
    expect(evaluateSupport(null, { minimumSupported: "1.0.0" })).toBe(
      "unknown-version"
    );
  });
});

describe("nextSupportState", () => {
  const CLOSED: SupportGateState = { status: "current" };
  const BLOCKED: SupportGateState = {
    currentVersion: "0.1.20",
    status: "unsupported",
  };

  test("a completed check below the floor blocks the build", () => {
    expect(
      nextSupportState(
        CLOSED,
        { ok: true, policy: { minimumSupported: "0.1.21" } },
        "0.1.20"
      )
    ).toEqual(BLOCKED);
  });

  test("a completed check at or above the floor closes the gate", () => {
    // Including a server with no floor at all - a rollback. That is a real
    // answer from a server we reached, so it is allowed to lift a gate.
    expect(
      nextSupportState(
        BLOCKED,
        { ok: true, policy: { minimumSupported: null } },
        "0.1.20"
      )
    ).toEqual(CLOSED);
    expect(
      nextSupportState(
        BLOCKED,
        { ok: true, policy: { minimumSupported: "0.1.20" } },
        "0.1.20"
      )
    ).toEqual(CLOSED);
  });

  test("a failed check never closes a gate the server already put up", () => {
    // The regression: a "Check again" that cannot reach the server used to
    // resolve the gate, letting the one build we know is unsupported walk
    // straight back in. Silence is not an answer.
    expect(nextSupportState(BLOCKED, { ok: false }, "0.1.20")).toEqual(BLOCKED);
  });

  test("a failed check never blocks a build that was never retired", () => {
    // The launch path: silence means "not proven broken", so a first check that
    // cannot complete must not lock anyone out of the app.
    expect(nextSupportState(CLOSED, { ok: false }, "0.1.20")).toEqual(CLOSED);
  });

  test("an unreadable build version is never retired by a completed check", () => {
    // Nothing about the build is known, so nothing may be concluded from a
    // floor the server published.
    expect(
      nextSupportState(
        CLOSED,
        { ok: true, policy: { minimumSupported: "9.9.9" } },
        null
      )
    ).toEqual(CLOSED);
  });
});
