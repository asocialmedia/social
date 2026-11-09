import { describe, expect, test } from "bun:test";

import {
  LEGACY_PUSH_CHANNEL_ID,
  PUSH_CHANNELS,
  pushChannel,
  pushChannelForType,
} from "./channels";
import { NOTIFICATION_TYPES } from "./types";

describe("push channels", () => {
  test("every notification type has a channel that exists", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(pushChannel(pushChannelForType(type)).id).toBe(
        pushChannelForType(type)
      );
    }
  });

  test("conversation interrupts, social signals stay quiet", () => {
    expect(pushChannel(pushChannelForType("DEN_MESSAGE")).importance).toBe(
      "high"
    );
    expect(pushChannel(pushChannelForType("MENTION")).importance).toBe("high");
    expect(pushChannel(pushChannelForType("FOLLOW")).importance).toBe("low");
    expect(pushChannel(pushChannelForType("AMPLIFY")).importance).toBe("low");
  });

  test("no new channel reuses the legacy id, whose importance cannot change", () => {
    expect(PUSH_CHANNELS.map((channel) => channel.id)).not.toContain(
      LEGACY_PUSH_CHANNEL_ID
    );
  });
});
