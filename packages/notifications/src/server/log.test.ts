import { describe, expect, test } from "bun:test";

import { describePushError, endpointHost } from "./log";

describe("describePushError", () => {
  test("extracts status and message from a web-push style error", () => {
    const error = Object.assign(new Error("Gone"), { statusCode: 410 });
    expect(describePushError(error)).toEqual({
      reason: "Gone",
      status: 410,
    });
  });

  test("returns a null status for a plain Error", () => {
    expect(describePushError(new Error("offline"))).toEqual({
      reason: "offline",
      status: null,
    });
  });

  test("handles a non-object rejection without throwing", () => {
    expect(describePushError("boom").reason).toBe("boom");
    expect(describePushError().reason).toBe("undefined");
  });

  test("truncates a long message so a log line stays bounded", () => {
    const error = new Error("x".repeat(500));
    expect(describePushError(error).reason.length).toBe(120);
  });

  test("never surfaces token-like fields", () => {
    // A rejection carrying a token must not leak it through the reason.
    const error = Object.assign(new Error("failed"), {
      statusCode: 400,
      token: "secret-device-token",
    });
    const detail = describePushError(error);
    expect(JSON.stringify(detail)).not.toContain("secret-device-token");
  });
});

describe("endpointHost", () => {
  test("returns only the host of a push endpoint", () => {
    expect(
      endpointHost("https://fcm.googleapis.com/fcm/send/SECRET-SUBSCRIPTION-ID")
    ).toBe("fcm.googleapis.com");
  });

  test("drops the path, so the subscription id never reaches a log", () => {
    const host = endpointHost(
      "https://updates.push.services.mozilla.com/wpush/v2/SECRET"
    );
    expect(host).toBe("updates.push.services.mozilla.com");
    expect(host).not.toContain("SECRET");
  });

  test("reports an unparseable endpoint as invalid", () => {
    expect(endpointHost("not a url")).toBe("invalid");
  });
});
