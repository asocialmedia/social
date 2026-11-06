import { describe, expect, test } from "bun:test";

import { communityChatFeatureEnabled } from "./community-chat-features";

describe("community chat rollout", () => {
  test("requires an explicit production opt-in", () => {
    expect(communityChatFeatureEnabled(undefined, "production")).toBe(false);
    expect(communityChatFeatureEnabled()).toBe(false);
    expect(communityChatFeatureEnabled("true", "production")).toBe(true);
    expect(communityChatFeatureEnabled("TRUE", "production")).toBe(false);
  });

  test("supports local development and an explicit kill switch", () => {
    expect(communityChatFeatureEnabled(undefined, "development")).toBe(true);
    expect(communityChatFeatureEnabled(undefined, "test")).toBe(true);
    expect(communityChatFeatureEnabled("false", "development")).toBe(false);
  });
});
