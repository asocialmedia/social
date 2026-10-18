import { describe, expect, test } from "bun:test";

import {
  COMMUNITY_CHAT_HISTORY_PAGE_LIMIT,
  COMMUNITY_CHAT_MAX_TEXT_LENGTH,
  parseCommunityChatText,
} from "./community-chat";

describe("community chat contracts", () => {
  test("keeps history pages and text payloads bounded", () => {
    expect(COMMUNITY_CHAT_HISTORY_PAGE_LIMIT).toBe(100);
    expect(COMMUNITY_CHAT_MAX_TEXT_LENGTH).toBe(4000);
    expect(parseCommunityChatText("  hello community  ")).toEqual({
      content: "hello community",
      type: "text",
    });
  });

  test("rejects empty, non-text, and oversized messages", () => {
    expect(() => parseCommunityChatText(" \n ")).toThrow();
    expect(() => parseCommunityChatText({ content: "hello" })).toThrow();
    expect(() => parseCommunityChatText("x".repeat(4001))).toThrow();
  });
});
