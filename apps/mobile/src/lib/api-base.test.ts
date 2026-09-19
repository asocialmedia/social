import { describe, expect, test } from "bun:test";

import {
  DEV_ANDROID_EMULATOR_API_URL,
  DEV_DEFAULT_API_URL,
  PROD_API_URL,
  authBaseUrl,
  normalizeBaseUrl,
  resolveApiBaseUrl,
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

  test("dev on android emulator routes to 10.0.2.2", () => {
    expect(resolveApiBaseUrl({ dev: true, platform: "android" })).toBe(
      DEV_ANDROID_EMULATOR_API_URL
    );
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
