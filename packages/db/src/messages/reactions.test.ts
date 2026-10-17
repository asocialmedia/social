import { describe, expect, test } from "bun:test";

import { isMessageReactionEmoji, MESSAGE_REACTION_EMOJIS } from "./reactions";

describe("message reaction choices", () => {
  test("accepts the full catalog while keeping five quick reactions", async () => {
    expect(MESSAGE_REACTION_EMOJIS).toEqual(["❤️", "👍", "😂", "😮", "😢"]);
    const valid = [
      ...MESSAGE_REACTION_EMOJIS,
      "🔥",
      "💯",
      "❤️‍🔥",
      "👍🏽",
      "🇮🇳",
      "👩‍💻",
    ];
    expect(await Promise.all(valid.map(isMessageReactionEmoji))).toEqual(
      valid.map(() => true)
    );
    const invalid = [
      "",
      "hello",
      "👍👍",
      "🇦",
      "🏽",
      "❤️ text",
      "a".repeat(100),
    ];
    expect(await Promise.all(invalid.map(isMessageReactionEmoji))).toEqual(
      invalid.map(() => false)
    );
  });
});
