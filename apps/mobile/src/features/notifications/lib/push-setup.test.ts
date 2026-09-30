// Tests for push setup prechecks and copy.
import { describe, expect, test } from "bun:test";

import { pushSetupCopy, pushSetupPrecheck } from "./push-setup";

describe("pushSetupPrecheck", () => {
  test("expo go short-circuits", () => {
    expect(pushSetupPrecheck({ executionEnvironment: "storeClient", platform: "android" })).toBe("expo-go");
  });
  test("ios unsupported", () => {
    expect(pushSetupPrecheck({ platform: "ios" })).toBe("ios-unsupported");
  });
  test("android dev build passes precheck", () => {
    expect(pushSetupPrecheck({ executionEnvironment: "bare", platform: "android" })).toBeNull();
  });
});

describe("pushSetupCopy", () => {
  test("expo go copy names dev build", () => {
    const copy = pushSetupCopy({ detail: "expo-go", reason: "expo-go" });
    expect(copy.title).toContain("dev build");
  });
  test("ready is empty", () => {
    expect(pushSetupCopy({ detail: "ok", reason: "ready" }).title).toBe("");
  });
});
