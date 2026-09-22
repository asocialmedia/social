import { describe, expect, test } from "bun:test";

import {
  buildTurnstilePage,
  isAllowedTurnstileNavigation,
  parseTurnstileMessage,
  resolveTurnstileBaseUrl,
} from "./turnstile-page";

describe("resolveTurnstileBaseUrl", () => {
  test("prefers an explicit origin and strips trailing slashes", () => {
    expect(
      resolveTurnstileBaseUrl("http://localhost:3000///", "https://api.test")
    ).toBe("http://localhost:3000");
  });

  test("falls back to the API origin in release builds", () => {
    expect(resolveTurnstileBaseUrl(undefined, "https://asocialmedia.cc")).toBe(
      "https://asocialmedia.cc"
    );
    expect(resolveTurnstileBaseUrl("", "https://asocialmedia.cc/")).toBe(
      "https://asocialmedia.cc"
    );
  });

  test("treats a whitespace-only override as unset", () => {
    expect(resolveTurnstileBaseUrl("   ", "https://asocialmedia.cc")).toBe(
      "https://asocialmedia.cc"
    );
  });
});

describe("parseTurnstileMessage", () => {
  test("parses a verify message", () => {
    expect(
      parseTurnstileMessage(JSON.stringify({ token: "abc", type: "verify" }))
    ).toEqual({
      token: "abc",
      type: "verify",
    });
  });

  test("rejects a verify message with no token", () => {
    expect(
      parseTurnstileMessage(JSON.stringify({ token: "", type: "verify" }))
    ).toBeNull();
    expect(
      parseTurnstileMessage(JSON.stringify({ type: "verify" }))
    ).toBeNull();
  });

  test("parses an error message and defaults a missing code", () => {
    expect(
      parseTurnstileMessage(JSON.stringify({ code: "110200", type: "error" }))
    ).toEqual({ code: "110200", type: "error" });
    expect(parseTurnstileMessage(JSON.stringify({ type: "error" }))).toEqual({
      code: "unknown",
      type: "error",
    });
  });

  test("parses ready, expired and timeout", () => {
    expect(parseTurnstileMessage(JSON.stringify({ type: "ready" }))).toEqual({
      type: "ready",
    });
    expect(parseTurnstileMessage(JSON.stringify({ type: "expired" }))).toEqual({
      type: "expired",
    });
    expect(parseTurnstileMessage(JSON.stringify({ type: "timeout" }))).toEqual({
      type: "timeout",
    });
  });

  test("rejects non-strings, bad JSON and unknown types", () => {
    expect(parseTurnstileMessage(null)).toBeNull();
    expect(parseTurnstileMessage(42)).toBeNull();
    expect(parseTurnstileMessage("not json")).toBeNull();
    expect(
      parseTurnstileMessage(JSON.stringify({ type: "surprise" }))
    ).toBeNull();
    expect(parseTurnstileMessage(JSON.stringify(null))).toBeNull();
  });
});

describe("buildTurnstilePage", () => {
  const options = {
    action: "mobile-register",
    appearance: "always" as const,
    sitekey: "0xAAAA-test-key",
  };

  test("includes the sitekey, action and appearance", () => {
    const page = buildTurnstilePage(options);
    expect(page).toContain("0xAAAA-test-key");
    expect(page).toContain("mobile-register");
    expect(page).toContain("always");
  });

  test("loads Turnstile in explicit render mode", () => {
    const page = buildTurnstilePage(options);
    expect(page).toContain("api.js?render=explicit");
    expect(page).toContain("turnstile.render");
  });

  test("forwards every callback to React Native", () => {
    const page = buildTurnstilePage(options);
    for (const type of ["verify", "error", "expired", "timeout", "ready"]) {
      expect(page).toContain(`type: '${type}'`);
    }
    expect(page).toContain("ReactNativeWebView.postMessage");
  });

  test("exposes reset and execute hooks", () => {
    const page = buildTurnstilePage(options);
    expect(page).toContain("asmTurnstileReset");
    expect(page).toContain("asmTurnstileExecute");
  });

  test("escapes values that could break out of the script element", () => {
    const page = buildTurnstilePage({
      ...options,
      sitekey: "</script><script>alert(1)</script>",
    });
    expect(page).not.toContain("</script><script>alert(1)");
    expect(page).toContain("\\u003c");
  });
});

describe("isAllowedTurnstileNavigation", () => {
  test("allows the widget origin and the blank inline page", () => {
    expect(
      isAllowedTurnstileNavigation(
        "https://challenges.cloudflare.com/turnstile/v0/api.js"
      )
    ).toBe(true);
    expect(isAllowedTurnstileNavigation("about:blank")).toBe(true);
  });

  test("rejects hosts that merely start with the challenge origin", () => {
    expect(
      isAllowedTurnstileNavigation(
        "https://challenges.cloudflare.com.evil.example/"
      )
    ).toBe(false);
    expect(isAllowedTurnstileNavigation("https://evil.example/")).toBe(false);
  });

  test("rejects unparseable URLs", () => {
    expect(isAllowedTurnstileNavigation("::::")).toBe(false);
  });
});
