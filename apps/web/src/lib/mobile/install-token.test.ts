import { describe, expect, test } from "bun:test";

import {
  INSTALL_TOKEN_HEADER,
  issueInstallToken,
  resolveInstallTokenSecret,
  verifyInstallToken,
} from "./install-token";

const SECRET = "test-secret-value";

describe("resolveInstallTokenSecret", () => {
  test("prefers the dedicated install secret", () => {
    expect(
      resolveInstallTokenSecret({
        BETTER_AUTH_SECRET: "fallback",
        MOBILE_INSTALL_SECRET: "dedicated",
      })
    ).toBe("dedicated");
  });

  test("falls back to the auth secret", () => {
    expect(resolveInstallTokenSecret({ BETTER_AUTH_SECRET: "fallback" })).toBe(
      "fallback"
    );
  });

  test("returns null when nothing is configured", () => {
    expect(resolveInstallTokenSecret({})).toBeNull();
    expect(
      resolveInstallTokenSecret({ MOBILE_INSTALL_SECRET: "   " })
    ).toBeNull();
  });
});

describe("issueInstallToken", () => {
  test("issues a verifiable token with a unique install id", () => {
    const first = issueInstallToken(SECRET);
    const second = issueInstallToken(SECRET);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.installId).not.toBe(second?.installId);

    const verified = verifyInstallToken(first?.token, SECRET);
    expect(verified?.installId).toBe(first?.installId);
  });

  test("returns null without a secret", () => {
    expect(issueInstallToken(null)).toBeNull();
  });
});

describe("verifyInstallToken", () => {
  test("accepts a freshly issued token", () => {
    const issued = issueInstallToken(SECRET);
    expect(verifyInstallToken(issued?.token, SECRET)).not.toBeNull();
  });

  test("rejects a token signed with another secret", () => {
    const issued = issueInstallToken(SECRET);
    expect(verifyInstallToken(issued?.token, "different-secret")).toBeNull();
  });

  test("rejects a tampered install id", () => {
    const issued = issueInstallToken(SECRET);
    const parts = (issued?.token ?? "").split(".");
    const forged = [
      parts[0],
      "AAAAAAAAAAAAAAAAAAAAAA",
      parts[2],
      parts[3],
    ].join(".");
    expect(verifyInstallToken(forged, SECRET)).toBeNull();
  });

  test("rejects a tampered timestamp", () => {
    const now = 1_700_000_000_000;
    const issued = issueInstallToken(SECRET, now);
    const parts = (issued?.token ?? "").split(".");
    // Move the date forward, keeping the original signature: it must not verify.
    const forged = [parts[0], parts[1], String(now + 60_000), parts[3]].join(
      "."
    );
    expect(verifyInstallToken(forged, SECRET, { now })).toBeNull();
  });

  test("rejects malformed and empty input", () => {
    for (const bad of ["", "v1", "v1.a", "v1.a.b", "v2.a.1.sig", "v1..1.sig"]) {
      expect(verifyInstallToken(bad, SECRET)).toBeNull();
    }
    expect(verifyInstallToken(null, SECRET)).toBeNull();
    expect(verifyInstallToken(undefined, SECRET)).toBeNull();
  });

  test("rejects a token whose signature is the wrong length", () => {
    const issued = issueInstallToken(SECRET);
    const parts = (issued?.token ?? "").split(".");
    expect(
      verifyInstallToken(
        [parts[0], parts[1], parts[2], "short"].join("."),
        SECRET
      )
    ).toBeNull();
  });

  test("rejects an expired token but accepts it within the window", () => {
    const now = 1_700_000_000_000;
    const issued = issueInstallToken(SECRET, now);
    expect(verifyInstallToken(issued?.token, SECRET, { now })).not.toBeNull();
    expect(
      verifyInstallToken(issued?.token, SECRET, {
        maxAgeMs: 1000,
        now: now + 2000,
      })
    ).toBeNull();
  });

  test("rejects a far future-dated token", () => {
    const now = 1_700_000_000_000;
    const issued = issueInstallToken(SECRET, now + 10 * 60_000);
    expect(verifyInstallToken(issued?.token, SECRET, { now })).toBeNull();
  });

  test("returns null when no secret is configured", () => {
    const issued = issueInstallToken(SECRET);
    expect(verifyInstallToken(issued?.token, null)).toBeNull();
  });
});

describe("INSTALL_TOKEN_HEADER", () => {
  test("is a lowercase custom header", () => {
    expect(INSTALL_TOKEN_HEADER).toBe("x-asm-install");
  });
});
