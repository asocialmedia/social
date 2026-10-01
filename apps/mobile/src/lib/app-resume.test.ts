// Pure tests for app resume helpers.
import { describe, expect, test } from "bun:test";

import {
  clearMemoryResume,
  isFreshResume,
  isResumablePath,
  parseResumeState,
  serializeResumeState,
} from "./app-resume";

describe("isResumablePath", () => {
  test("home resumes", () => {
    expect(isResumablePath("/")).toBe(true);
  });
  test("auth never resumes", () => {
    expect(isResumablePath("/(auth)/login")).toBe(false);
  });
  test("post detail resumes", () => {
    expect(isResumablePath("/posts/abcd1234")).toBe(true);
  });
  test("unknown route does not resume", () => {
    expect(isResumablePath("/messages")).toBe(false);
  });
});

describe("resume freshness", () => {
  test("fresh within ttl", () => {
    expect(isFreshResume({ pathname: "/", updatedAt: 1000 }, 2000)).toBe(true);
  });
  test("expired", () => {
    expect(
      isFreshResume({ pathname: "/", updatedAt: 0 }, 8 * 24 * 3600 * 1000)
    ).toBe(false);
  });
  test("parse round trip", () => {
    clearMemoryResume();
    const body = serializeResumeState("/discover", {}, 1000);
    expect(parseResumeState(body)?.pathname).toBe("/discover");
  });
  test("corrupt returns null", () => {
    expect(parseResumeState("{nope")).toBeNull();
  });
});
