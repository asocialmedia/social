import { describe, expect, test } from "bun:test";

import { composerModeForTarget, targetAllowsKind } from "./camera-target";

describe("composerModeForTarget", () => {
  test("gusts compose as gusts, fleet and community compose as fleets", () => {
    expect(composerModeForTarget("gust")).toBe("gust");
    expect(composerModeForTarget("fleet")).toBe("post");
    expect(composerModeForTarget("community")).toBe("post");
  });
});

describe("targetAllowsKind", () => {
  test("gusts require video, fleets and community accept either", () => {
    expect(targetAllowsKind("gust", "video")).toBe(true);
    expect(targetAllowsKind("gust", "photo")).toBe(false);
    expect(targetAllowsKind("fleet", "photo")).toBe(true);
    expect(targetAllowsKind("community", "video")).toBe(true);
  });
});
