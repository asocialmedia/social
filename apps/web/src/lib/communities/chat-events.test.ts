import { describe, expect, test } from "bun:test";

import { createCommunityChatLiveEventCache } from "./chat-events";

describe("community realtime serialization", () => {
  const raw = JSON.stringify({
    changeSequence: "12",
    kind: "message.created",
    messageId: "message",
    roomId: "channel",
  });

  test("shares parsed data and immutable wire bytes between room viewers", () => {
    const decode = createCommunityChatLiveEventCache();
    const first = decode("channel", raw);
    const second = decode("channel", raw);
    expect(first?.bytes).toBe(second?.bytes);
    expect(new TextDecoder().decode(first?.bytes)).toContain(
      "id: 12\nevent: change"
    );
  });

  test("rejects another room, malformed sequences, and oversized events", () => {
    const decode = createCommunityChatLiveEventCache();
    expect(decode("private-thread", raw)).toBeNull();
    expect(
      decode("channel", raw.replace('"12"', '"12\\ninjected"'))
    ).toBeNull();
    expect(decode("channel", "x".repeat(65 * 1024))).toBeNull();
  });

  test("evicts inactive room data when the process cache budget is reached", () => {
    const decode = createCommunityChatLiveEventCache(1);
    const first = decode("channel", raw);
    decode("other", raw.replace('"channel"', '"other"'));
    expect(decode("channel", raw)?.bytes).not.toBe(first?.bytes);
  });
});
