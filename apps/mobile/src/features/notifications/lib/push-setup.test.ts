// Tests for push setup prechecks and copy.
import { describe, expect, test } from "bun:test";

import {
  pushSetupCopy,
  pushSetupPrecheck,
  pushFailureStatus,
  publishPushSetupStatus,
  readPushSetupStatus,
  subscribePushSetupStatus,
} from "./push-setup";

describe("pushSetupPrecheck", () => {
  test("the native Expo Go marker wins over embedded manifest environment metadata", () => {
    expect(
      pushSetupPrecheck({
        executionEnvironment: "storeClient",
        isExpoGo: false,
        platform: "android",
      })
    ).toBeNull();
    expect(
      pushSetupPrecheck({
        executionEnvironment: "bare",
        isExpoGo: true,
        platform: "android",
      })
    ).toBe("expo-go");
  });
  test("standalone Android and Play-enabled emulators can register", () => {
    expect(
      pushSetupPrecheck({
        executionEnvironment: "standalone",
        isExpoGo: false,
        platform: "android",
      })
    ).toBeNull();
    expect(
      pushSetupPrecheck({ isExpoGo: false, platform: "android" })
    ).toBeNull();
  });
  test("expo go short-circuits", () => {
    expect(
      pushSetupPrecheck({
        executionEnvironment: "storeClient",
        platform: "android",
      })
    ).toBe("expo-go");
  });
  test("ios unsupported", () => {
    expect(pushSetupPrecheck({ platform: "ios" })).toBe("ios-unsupported");
  });
  test("android dev build passes precheck", () => {
    expect(
      pushSetupPrecheck({ executionEnvironment: "bare", platform: "android" })
    ).toBeNull();
  });
});

describe("live push diagnostics", () => {
  test("missing Firebase is distinguished from connectivity failure without leaking native error contents", () => {
    expect(
      pushFailureStatus(new Error("Default FirebaseApp is not initialized"))
        .reason
    ).toBe("no-firebase");
    expect(
      pushFailureStatus(new Error("SERVICE_NOT_AVAILABLE secret token"))
    ).toEqual({
      detail:
        "Couldn't register notifications. Check your connection and try again.",
      reason: "unknown",
    });
  });
  test("a successful retry clears the failure and detached observers are not notified", () => {
    const observed: string[] = [];
    const stop = subscribePushSetupStatus(() =>
      observed.push(readPushSetupStatus()?.reason ?? "reset")
    );
    publishPushSetupStatus({ detail: "off", reason: "permission-denied" });
    publishPushSetupStatus({ detail: "registered", reason: "ready" });
    expect(readPushSetupStatus()?.reason).toBe("ready");
    stop();
    publishPushSetupStatus(null);
    expect(observed).toEqual(["permission-denied", "ready"]);
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
