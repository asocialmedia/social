import { describe, expect, test } from "bun:test";

import { resolveApplicationLoginMethod } from "./config";

describe("resolveApplicationLoginMethod", () => {
  test("records the app's username credentials route as email sign-in", () => {
    expect(resolveApplicationLoginMethod("/sign-in/username")).toBe("email");
  });

  test("records a verified two-factor credential login as email sign-in", () => {
    expect(resolveApplicationLoginMethod("/two-factor/verify-otp")).toBe(
      "email"
    );
  });

  test("leaves Better Auth's built-in provider resolution unchanged", () => {
    expect(resolveApplicationLoginMethod("/callback/google")).toBeNull();
  });
});
