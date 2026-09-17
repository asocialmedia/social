import { describe, expect, test } from "bun:test";

import { parseServerSentFrame, shouldCatchUp } from "./use-messages-realtime";

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

describe("shouldCatchUp", () => {
  const now = 1_000_000;

  test("catches up when nothing has loaded yet", () => {
    expect(shouldCatchUp({ dataUpdatedAt: 0, isFetching: false, now })).toBe(
      true
    );
  });

  test("skips catch-up while a fetch is already in flight", () => {
    // The overwrite race: a reconnect must not stack a second GET whose
    // response can land after the first and replace fresh pages.
    expect(
      shouldCatchUp({ dataUpdatedAt: now - 60_000, isFetching: true, now })
    ).toBe(false);
  });

  test("skips catch-up when data was written recently", () => {
    expect(
      shouldCatchUp({ dataUpdatedAt: now - 2000, isFetching: false, now })
    ).toBe(false);
  });

  test("catches up once data goes stale", () => {
    expect(
      shouldCatchUp({ dataUpdatedAt: now - 30_000, isFetching: false, now })
    ).toBe(true);
  });

  test("honours a custom minimum age", () => {
    expect(
      shouldCatchUp({
        dataUpdatedAt: now - 5000,
        isFetching: false,
        minAgeMs: 1000,
        now,
      })
    ).toBe(true);
  });
});
