import { describe, expect, test } from "bun:test";

import { isMessageReactionEmoji, MESSAGE_REACTION_EMOJIS } from "./reactions";

describe("message reaction choices", () => {
  test("accepts only the supported reaction set", () => {
    expect(MESSAGE_REACTION_EMOJIS).toEqual([
      "❤️",
      "👍",
      "😂",
      "😮",
      "😢",
      "🔥",
    ]);
    for (const emoji of MESSAGE_REACTION_EMOJIS) {
      expect(isMessageReactionEmoji(emoji)).toBe(true);
    }
    expect(isMessageReactionEmoji("💯")).toBe(false);
    expect(isMessageReactionEmoji("❤️‍🔥")).toBe(false);
    expect(isMessageReactionEmoji("")).toBe(false);
  });
});
