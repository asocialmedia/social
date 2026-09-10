import { describe, expect, test } from "bun:test";

import {
  getSignupTurnstileConfig,
  verifySignupTurnstileToken,
} from "./turnstile";

const config = {
  allowedHostnames: ["asocialmedia.cc"],
  secret: "test-turnstile-secret",
};

const successfulSiteverify = (): Promise<Response> =>
  Promise.resolve(
    Response.json({
      action: "signup",
      hostname: "asocialmedia.cc",
      success: true,
    })
  );

const wrongActionSiteverify = (): Promise<Response> =>
  Promise.resolve(
    Response.json({
      action: "sign-in",
      hostname: "other.example",
      success: true,
    })
  );

const unavailableSiteverify = (): Promise<Response> =>
  Promise.resolve(new Response("unavailable", { status: 503 }));

describe("getSignupTurnstileConfig", () => {
  test("rejects local hostnames in production", () => {
    expect(
      getSignupTurnstileConfig({
        allowedHostnames: "localhost,asocialmedia.cc",
        environment: "production",
        secret: "test-turnstile-secret",
      })
    ).toBeUndefined();
  });

  test("normalizes configured hostnames", () => {
    expect(
      getSignupTurnstileConfig({
        allowedHostnames: " asocialmedia.cc,WWW.asocialmedia.cc ",
        environment: "production",
        secret: "test-turnstile-secret",
      })
    ).toEqual({
      allowedHostnames: ["asocialmedia.cc", "www.asocialmedia.cc"],
      secret: "test-turnstile-secret",
    });
  });
});

describe("verifySignupTurnstileToken", () => {
  test("accepts a valid signup token from an allowed hostname", async () => {
    await expect(
      verifySignupTurnstileToken(
        "token",
        "203.0.113.2",
        config,
        successfulSiteverify
      )
    ).resolves.toEqual({ success: true });
  });

  test("rejects a token minted for another action or hostname", async () => {
    await expect(
      verifySignupTurnstileToken(
        "token",
        undefined,
        config,
        wrongActionSiteverify
      )
    ).resolves.toEqual({ reason: "invalid-token", success: false });
  });

  test("fails closed when Siteverify is unavailable", async () => {
    await expect(
      verifySignupTurnstileToken(
        "token",
        undefined,
        config,
        unavailableSiteverify
      )
    ).resolves.toEqual({ reason: "unavailable", success: false });
  });
});
