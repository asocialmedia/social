import { describe, expect, test } from "bun:test";

import { resolveAuthBaseUrl } from "./config";

// AUTH_URL is the existing variable for this, and it is set in development but
// not in the deployed auth service. Because `keys` runs with skipValidation in
// production its schema default never applies there, so the unset case resolves
// to nothing rather than to localhost - which is what had better-auth warning
// "[better-auth] Base URL is not set" on every boot of both services.
describe("resolveAuthBaseUrl", () => {
  test("prefers the base URL the caller was configured with", () => {
    expect(
      resolveAuthBaseUrl({
        authUrl: "https://auth.example",
        baseURL: "https://auth.internal:3001",
        betterAuthUrl: "https://auth.from-env",
      })
    ).toBe("https://auth.internal:3001");
  });

  test("prefers BETTER_AUTH_URL, which is the name better-auth itself documents", () => {
    expect(
      resolveAuthBaseUrl({
        authUrl: "https://auth.example",
        baseURL: undefined,
        betterAuthUrl: "https://auth.from-env",
      })
    ).toBe("https://auth.from-env");
  });

  test("uses AUTH_URL when that is all there is", () => {
    expect(
      resolveAuthBaseUrl({
        authUrl: "https://auth.example",
        baseURL: undefined,
        betterAuthUrl: undefined,
      })
    ).toBe("https://auth.example");
  });

  test("is empty rather than invented when nothing is configured", () => {
    // Not a hardcoded production URL: this repo derives allowed origins from
    // the environment, and a wrong absolute URL is worse than none. better-auth
    // derives the origin from the request, which is what the auth service runs
    // on today, and setting AUTH_URL in the deployment removes the ambiguity.
    expect(
      resolveAuthBaseUrl({
        authUrl: undefined,
        baseURL: undefined,
        betterAuthUrl: undefined,
      })
    ).toBeUndefined();
  });

  test("treats a blank variable as unset, which is what an empty secret looks like", () => {
    // process.env is "" for a variable that exists but has no value, so a
    // Dokploy secret left blank must not become the base URL.
    expect(
      resolveAuthBaseUrl({
        authUrl: "",
        baseURL: undefined,
        betterAuthUrl: "   ",
      })
    ).toBe("   ");
    expect(
      resolveAuthBaseUrl({
        authUrl: "",
        baseURL: undefined,
        betterAuthUrl: "",
      })
    ).toBeUndefined();
  });
});
