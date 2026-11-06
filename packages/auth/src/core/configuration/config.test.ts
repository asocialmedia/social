import { describe, expect, test } from "bun:test";

import {
  hashPasswordWithScrypt,
  verifyPasswordHash,
} from "../security/password";
import { describeUserAgent, extractTokenFromUrl } from "./config";

describe("extractTokenFromUrl", () => {
  test("extracts token from better-auth reset url with callbackURL", () => {
    const url =
      "http://localhost:3001/reset-password/abc123def456?callbackURL=";
    expect(extractTokenFromUrl(url)).toBe("abc123def456");
  });

  test("extracts token from query param style url", () => {
    const url = "http://localhost:3000/reset-password/confirm?token=tok123";
    expect(extractTokenFromUrl(url)).toBe("tok123");
  });

  test("extracts token from bare path", () => {
    expect(
      extractTokenFromUrl("http://localhost:3001/reset-password/mytoken")
    ).toBe("mytoken");
  });

  test("handles malformed url gracefully", () => {
    expect(extractTokenFromUrl("not-a-url")).toBe("not-a-url");
  });

  test("prefers query token over path token", () => {
    const url = "http://localhost:3000/verify-email?token=querytok";
    expect(extractTokenFromUrl(url)).toBe("querytok");
  });
});

describe("password verification (emailAndPassword.password.verify)", () => {
  test("verifies a raw scrypt hash", async () => {
    const password = "SuperSecret123!";
    const hash = await hashPasswordWithScrypt(password);

    expect(await verifyPasswordHash(password, hash)).toBe(true);
    expect(await verifyPasswordHash("wrong", hash)).toBe(false);
  });

  test('verifies a JSON-wrapped {"hash": ...} value', async () => {
    const password = "SuperSecret123!";
    const hash = await hashPasswordWithScrypt(password);
    const wrapped = JSON.stringify({ hash });

    expect(await verifyPasswordHash(password, wrapped)).toBe(true);
    expect(await verifyPasswordHash("wrong", wrapped)).toBe(false);
  });

  test("rejects an unrecognized stored value", async () => {
    expect(await verifyPasswordHash("password", 42)).toBe(false);
    expect(await verifyPasswordHash("password")).toBe(false);
  });
});

describe("describeUserAgent", () => {
  test("returns a placeholder when there is no user agent", () => {
    const absent: string | null | undefined = undefined;

    expect(describeUserAgent(null)).toBe("Unknown browser");
    expect(describeUserAgent(absent)).toBe("Unknown browser");
    expect(describeUserAgent("")).toBe("Unknown browser");
  });

  test("names the browser and platform a real Chrome request reports", () => {
    const chrome =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

    // Safari's engine string appears in Chrome's agent, so the order of the
    // patterns is what keeps this from being reported as Safari.
    expect(describeUserAgent(chrome)).toBe("Chrome on macOS");
  });

  test("prefers Edge and Opera over the Chrome token they also carry", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0"
      )
    ).toBe("Edge on Windows");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36 OPR/105.0.0.0"
      )
    ).toBe("Opera on Windows");
  });

  test("reports an iPad as iOS rather than macOS", () => {
    const ipad =
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";

    expect(describeUserAgent(ipad)).toBe("Safari on iOS");
  });

  test("falls back on each half independently", () => {
    expect(describeUserAgent("curl/8.4.0")).toBe(
      "A browser on an unknown device"
    );
  });
});
