// Pure tests for app resume helpers.
import { describe, expect, test } from "bun:test";

import {
  clearMemoryResume,
  isFreshResume,
  isResumablePath,
  parseResumeState,
  serializeResumeState,
  createLaunchResumeReader,
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

describe("launch resume ordering", () => {
  test("startup readers share the previous route even after a new route is saved", async () => {
    let route = { pathname: "/posts/real-post", updatedAt: 1000 };
    let reads = 0;
    const readLaunch = createLaunchResumeReader(() => {
      reads += 1;
      return Promise.resolve(route);
    });
    const saverRead = readLaunch();
    const gateRead = readLaunch();
    expect(saverRead).toBe(gateRead);
    await saverRead;
    route = { pathname: "/", updatedAt: 2000 };
    const gateRoute = await gateRead;
    expect(gateRoute?.pathname).toBe("/posts/real-post");
    const restored = await readLaunch();
    expect(restored?.pathname).toBe("/posts/real-post");
    expect(reads).toBe(1);
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
