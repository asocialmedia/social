import { describe, expect, test } from "bun:test";

import { scopeReadiness } from "./readiness";
import type { ReadinessItem } from "./readiness";

function item(overrides: Partial<ReadinessItem>): ReadinessItem {
  return {
    error: null,
    mediaId: "m1",
    status: "ready",
    waitForProcessing: false,
    ...overrides,
  };
}

describe("scopeReadiness", () => {
  test("ready tiles publish with their ids in order", () => {
    expect(
      scopeReadiness([item({ mediaId: "a" }), item({ mediaId: "b" })])
    ).toEqual({ hasError: false, isBusy: false, mediaIds: ["a", "b"] });
  });

  test("an uploading tile blocks", () => {
    expect(
      scopeReadiness([item({ mediaId: null, status: "uploading" })]).isBusy
    ).toBe(true);
  });

  test("a post tile processing in background does not block", () => {
    const result = scopeReadiness([item({ status: "processing" })]);
    expect(result.isBusy).toBe(false);
    expect(result.mediaIds).toEqual(["m1"]);
  });

  test("an eddie tile waits for READY", () => {
    expect(
      scopeReadiness([item({ status: "processing", waitForProcessing: true })])
        .isBusy
    ).toBe(true);
  });

  test("an errored tile blocks through hasError, not busy", () => {
    expect(scopeReadiness([item({ status: "error" })])).toEqual({
      hasError: true,
      isBusy: false,
      mediaIds: ["m1"],
    });
  });

  test("a detached tile blocks until retry re-attaches the watcher", () => {
    expect(
      scopeReadiness([item({ error: "Still processing", status: "detached" })])
    ).toEqual({ hasError: true, isBusy: false, mediaIds: ["m1"] });
  });

  test("a detached eddie tile blocks through hasError, like web", () => {
    expect(
      scopeReadiness([item({ status: "detached", waitForProcessing: true })])
        .isBusy
    ).toBe(false);
  });
});
