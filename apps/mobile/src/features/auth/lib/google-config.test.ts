import { describe, expect, test } from "bun:test";

import { resolveGoogleWebClientId } from "./google-config";

describe("Google OAuth audience", () => {
  test("keeps production native sign-in available when CI has no public override", () => {
    expect(
      resolveGoogleWebClientId({
        apiBaseUrl: "https://asocialmedia.cc",
        configuredClientId: "",
        development: false,
      })
    ).toBe(
      "724936986991-eqsgnln62as0ivh94csq1vtlt4e74d9q.apps.googleusercontent.com"
    );
  });

  test("honors configured audiences and does not guess for other servers", () => {
    expect(
      resolveGoogleWebClientId({
        apiBaseUrl: "http://localhost:3000",
        configuredClientId: " dev-client ",
        development: true,
      })
    ).toBe("dev-client");
    expect(
      resolveGoogleWebClientId({
        apiBaseUrl: "https://preview.example",
        configuredClientId: undefined,
        development: false,
      })
    ).toBeUndefined();
    expect(
      resolveGoogleWebClientId({
        apiBaseUrl: "https://asocialmedia.cc",
        configuredClientId: undefined,
        development: true,
      })
    ).toBeUndefined();
  });
});
