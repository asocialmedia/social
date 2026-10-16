import { expect, test } from "bun:test";

import { normalizeSessionAddress, sessionMetadata } from "./session-metadata";

test("missing IP placeholders are not recorded as real addresses", () => {
  for (const value of [
    undefined,
    null,
    "",
    "unknown",
    "0.0.0.0",
    "::",
    "0000:0000:0000:0000:0000:0000:0000:0000",
  ]) {
    expect(normalizeSessionAddress(value)).toBeNull();
  }
  expect(normalizeSessionAddress("8.8.8.8")).toBe("8.8.8.8");
  expect(
    normalizeSessionAddress("0000:0000:0000:0000:0000:0000:0000:0001")
  ).toBe("::1");
});

test("native login records the app's user agent and country without changing the session", () => {
  const agent = "Asocialmedia/0.1.89 (Android 16; Pixel 9)";
  expect(
    sessionMetadata(
      { ipAddress: "::", userAgent: "okhttp/4.12" },
      new Headers({
        "cf-ipcountry": "IN",
        "user-agent": agent,
        "x-asm-client": "mobile",
      })
    )
  ).toEqual({ country: "IN", ipAddress: null, userAgent: agent });
  expect(
    sessionMetadata(
      { userAgent: "Chrome/152" },
      new Headers({ "cf-ipcountry": "T1" })
    )
  ).toEqual({ ipAddress: null, userAgent: "Chrome/152" });
});
