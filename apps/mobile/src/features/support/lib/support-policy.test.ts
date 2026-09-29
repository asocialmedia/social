import { describe, expect, test } from "bun:test";

import {
  compareVersions,
  evaluateSupport,
  parseVersion,
} from "./support-policy";

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
