import { describe, expect, test } from "bun:test";

import {
  DEV_ANDROID_API_URL,
  DEV_ANDROID_EMULATOR_ALIAS_URL,
  DEV_DEFAULT_API_URL,
  PROD_API_URL,
  authBaseUrl,
  normalizeBaseUrl,
  resolveApiBaseUrl,
  supportsPasskeyOrigin,
} from "./api-base";

describe("normalizeBaseUrl", () => {
  test("strips trailing slashes", () => {
    expect(normalizeBaseUrl("https://asocialmedia.cc///")).toBe(
      "https://asocialmedia.cc"
    );
  });

  test("trims whitespace", () => {
    expect(normalizeBaseUrl("  http://localhost:3000/ ")).toBe(
      "http://localhost:3000"
    );
  });
});

describe("resolveApiBaseUrl", () => {
  test("release builds use prod by default", () => {
    expect(resolveApiBaseUrl({ dev: false, platform: "android" })).toBe(
      PROD_API_URL
    );
  });

  test("release builds honor EXPO_PUBLIC_API_URL", () => {
    expect(
      resolveApiBaseUrl({
        dev: false,
        platform: "android",
        publicApiUrl: "https://staging.example.com/",
      })
    ).toBe("https://staging.example.com");
  });

  test("release builds treat a whitespace-only override as unset", () => {
    expect(
      resolveApiBaseUrl({
        dev: false,
        platform: "android",
        publicApiUrl: "   ",
      })
    ).toBe(PROD_API_URL);
  });

  test("release builds refuse a cleartext override", () => {
    // The session cookie rides every request, so http:// must never be used.
    expect(
      resolveApiBaseUrl({
        dev: false,
        platform: "android",
        publicApiUrl: "http://evil.example.com",
      })
    ).toBe(PROD_API_URL);
  });

  test("release builds refuse a non-http(s) override", () => {
    expect(
      resolveApiBaseUrl({
        dev: false,
        platform: "android",
        publicApiUrl: "ftp://example.com",
      })
    ).toBe(PROD_API_URL);
  });

  test("dev on android routes to localhost (adb reverse)", () => {
    // Same host as the auth service redirect and the Turnstile origin, so
    // browser OAuth can complete on the emulator.
    expect(resolveApiBaseUrl({ dev: true, platform: "android" })).toBe(
      DEV_ANDROID_API_URL
    );
    expect(DEV_ANDROID_API_URL).toBe("http://localhost:3000");
  });

  test("the emulator alias stays available as an explicit override", () => {
    expect(
      resolveApiBaseUrl({
        dev: true,
        devApiUrl: DEV_ANDROID_EMULATOR_ALIAS_URL,
        platform: "android",
      })
    ).toBe("http://10.0.2.2:3000");
  });

  test("dev on ios simulator routes to localhost", () => {
    expect(resolveApiBaseUrl({ dev: true, platform: "ios" })).toBe(
      DEV_DEFAULT_API_URL
    );
  });

  test("dev honors physical-device override", () => {
    expect(
      resolveApiBaseUrl({
        dev: true,
        devApiUrl: "http://192.168.1.5:3000",
        platform: "android",
      })
    ).toBe("http://192.168.1.5:3000");
  });
});

describe("authBaseUrl", () => {
  test("points at the web proxy auth handler", () => {
    expect(authBaseUrl("https://asocialmedia.cc")).toBe(
      "https://asocialmedia.cc/api/auth"
    );
  });
});

describe("supportsPasskeyOrigin", () => {
  test("only https origins can host a WebAuthn ceremony", () => {
    expect(supportsPasskeyOrigin(PROD_API_URL)).toBe(true);
    expect(supportsPasskeyOrigin(DEV_ANDROID_API_URL)).toBe(false);
    expect(supportsPasskeyOrigin(DEV_ANDROID_EMULATOR_ALIAS_URL)).toBe(false);
  });
});
