import { describe, expect, test } from "bun:test";

import { scopeReadiness } from "./readiness";
import type { ReadinessItem } from "./readiness";

function item(overrides: Partial<ReadinessItem>): ReadinessItem {
  return {
    isProcessing: false,
    mediaId: "m1",
    stage: "ready",
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
      scopeReadiness([item({ mediaId: null, stage: "uploading" })]).isBusy
    ).toBe(true);
  });

  test("a post tile processing in background does not block", () => {
    const result = scopeReadiness([
      item({ isProcessing: true, stage: "processing" }),
    ]);
    expect(result.isBusy).toBe(false);
    expect(result.mediaIds).toEqual(["m1"]);
  });

  test("an eddie tile waits for READY", () => {
    expect(
      scopeReadiness([
        item({
          isProcessing: true,
          stage: "processing",
          waitForProcessing: true,
        }),
      ]).isBusy
    ).toBe(true);
  });

  test("an errored tile blocks through hasError, not busy", () => {
    expect(scopeReadiness([item({ stage: "error" })])).toEqual({
      hasError: true,
      isBusy: false,
      mediaIds: ["m1"],
    });
  });
});
