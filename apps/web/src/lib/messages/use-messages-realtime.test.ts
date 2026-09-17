import { describe, expect, test } from "bun:test";

import { parseServerSentFrame } from "./use-messages-realtime";

describe("parseServerSentFrame", () => {
  test("splits event type and data", () => {
    expect(parseServerSentFrame('event: message\ndata: {"a":1}')).toEqual({
      data: '{"a":1}',
      eventType: "message",
    });
  });

  test("defaults a bare data frame to message events", () => {
    expect(parseServerSentFrame("data: hello")).toEqual({
      data: "hello",
      eventType: "message",
    });
  });

  test("surfaces the connected greeting for catch-up handling", () => {
    expect(
      parseServerSentFrame('event: connected\ndata: {"conversationId":"c"}')
    ).toEqual({
      data: '{"conversationId":"c"}',
      eventType: "connected",
    });
  });

  test("ignores heartbeat comments with no data", () => {
    expect(parseServerSentFrame(": keep-alive")).toEqual({
      data: null,
      eventType: "message",
    });
  });
});
