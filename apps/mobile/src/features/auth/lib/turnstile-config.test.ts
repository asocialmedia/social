import { describe, expect, test } from "bun:test";

import { resolveTurnstileSiteKey } from "./turnstile-config";

describe("release verification configuration", () => {
  test("production releases can register an install without development env files", () => {
    expect(
      resolveTurnstileSiteKey({
        apiBaseUrl: "https://asocialmedia.cc",
        configuredSiteKey: undefined,
        development: false,
      })
    ).toBe("0x4AAAAAAEuKQSsPABv2HAdA");
  });
  test("explicit keys take precedence over the production default", () => {
    expect(
      resolveTurnstileSiteKey({
        apiBaseUrl: "https://asocialmedia.cc",
        configuredSiteKey: " custom-key ",
        development: false,
      })
    ).toBe("custom-key");
  });
  test("development and alternate servers need their own widget configuration", () => {
    for (const options of [
      { apiBaseUrl: "https://staging.social.test", development: false },
      { apiBaseUrl: "https://asocialmedia.cc", development: true },
    ]) {
      expect(
        resolveTurnstileSiteKey({ ...options, configuredSiteKey: " " })
      ).toBeUndefined();
    }
  });
});
