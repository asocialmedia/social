import { describe, expect, test } from "bun:test";

import { isGoogleConfigurationError } from "./google-errors";

describe("native Google configuration fallback", () => {
  test("recognizes the Android SDK numeric error and named equivalent", () => {
    expect(isGoogleConfigurationError("10")).toBe(true);
    expect(isGoogleConfigurationError("DEVELOPER_ERROR")).toBe(true);
  });

  test("does not turn cancellation or network failures into browser retries", () => {
    expect(isGoogleConfigurationError("12501")).toBe(false);
    expect(isGoogleConfigurationError("7")).toBe(false);
    expect(isGoogleConfigurationError("IN_PROGRESS")).toBe(false);
  });
});
