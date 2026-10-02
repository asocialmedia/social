import { beforeEach, describe, expect, mock, test } from "bun:test";

import {
  DEN_ACTIVITY_STREAM_RATE_LIMIT,
  DEN_STREAM_RATE_LIMIT,
} from "@/lib/messages/den-rate-limit";
import { messageRouteLimiter } from "@/lib/messages/test-support/route-limiter-probe";

import { GET } from "./route";

// The per-user activity stream feeds the conversation list, so it exists for the
// conversations nobody has open. That makes it a second unbounded-subscriber door
// alongside the per-conversation stream, on a different channel and opened by a
// different component - which is exactly why it needs its own bucket rather than
// sharing the other one's.

const listeners = new Map<
  string,
  Set<(channel: string, raw: string) => void>
>();

const subscribeToChannel = mock(
  (channel: string, listener: (channel: string, raw: string) => void) => {
    const existing = listeners.get(channel) ?? new Set();
    existing.add(listener);
    listeners.set(channel, existing);
    return { unsubscribe: () => Promise.resolve() };
  }
);
const mockPublishActivity = mock(() => Promise.resolve());

// The limiter this route charges. Mocked explicitly because bun's
// `mock.module("@asm/db")` does not reach the rules module's own binding on it,
// and an unmocked limiter spends real Redis budget from the test suite.
const limiter = messageRouteLimiter();
mock.module("@/lib/messages/den-rate-limit", () => limiter.module);

let sessionUserId: string | null = "user-1";
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () =>
    sessionUserId ? Promise.resolve({ user: { id: sessionUserId } }) : null,
}));

mock.module("@asm/db", () => ({
  messageActivityChannel: (userId: string) => `activity:${userId}`,
  parseMessageActivityEvent: (raw: string) => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  },
  publishMessageActivity: mockPublishActivity,
  serializeMessageActivityEvent: (event: unknown) => JSON.stringify(event),
  subscribeToChannel,
}));

function open() {
  return GET(new Request("http://localhost/api/messages/events"));
}

beforeEach(() => {
  listeners.clear();
  subscribeToChannel.mockClear();
  mockPublishActivity.mockClear();
  sessionUserId = "user-1";
  limiter.reset();
});

describe("GET /api/messages/events", () => {
  test("opens a text/event-stream on the caller's own activity channel", async () => {
    const response = await open();
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe(
      "no-cache, no-transform"
    );
    expect(subscribeToChannel).toHaveBeenCalledTimes(1);
    expect(subscribeToChannel.mock.calls[0]?.[0]).toBe("activity:user-1");
    await response.body?.cancel();
  });

  test("requires auth", async () => {
    sessionUserId = null;
    const response = await open();
    expect(response.status).toBe(401);
    expect(subscribeToChannel).not.toHaveBeenCalled();
  });
});

describe("GET /api/messages/events rate limit", () => {
  test("spends the activity-stream budget, per account", async () => {
    const response = await open();
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(limiter.chargedBuckets).toEqual([
      DEN_ACTIVITY_STREAM_RATE_LIMIT.bucket,
    ]);
    expect(limiter.chargedIdentifiers).toEqual(["user-1"]);
    await response.body?.cancel();
  });

  test("429s with a retry-after and subscribes to nothing when over budget", async () => {
    // Constructing the stream is the expensive part: a request that never
    // completes, a twenty-second heartbeat for as long as it lives, and a slot in
    // the process's shared subscriber. The refusal has to land before any of it.
    limiter.setDenied(true);
    const response = await open();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("Content-Type")).not.toBe("text/event-stream");
    expect(subscribeToChannel).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  test("charges the limiter before it subscribes", async () => {
    const response = await open();
    expect(limiter.order[0]).toBe(
      `consume:${DEN_ACTIVITY_STREAM_RATE_LIMIT.bucket}`
    );
    await response.body?.cancel();
  });

  test("two accounts do not share one budget", async () => {
    const first = await open();
    await first.body?.cancel();
    sessionUserId = "user-2";
    const second = await open();
    await second.body?.cancel();
    expect(limiter.chargedIdentifiers).toEqual(["user-1", "user-2"]);
  });

  test("is metered on its own bucket from the per-conversation stream", () => {
    // Two subscribers, two channels, two different components opening them at
    // different rates. A shared bucket would let a loop against one exhaust the
    // other's budget, which is the failure `den-manage` was split to stop.
    expect(DEN_ACTIVITY_STREAM_RATE_LIMIT.bucket).not.toBe(
      DEN_STREAM_RATE_LIMIT.bucket
    );
  });

  test("the budget allows the reconnects a flaky connection actually makes", () => {
    // A client whose stream drops reconnects; thirty a minute is ten a
    // conversation's worth of tabs with several reconnects each. Pinned so a
    // future tightening has to say out loud that it is now below what a real
    // reconnect ladder produces.
    expect(DEN_ACTIVITY_STREAM_RATE_LIMIT.windowSeconds).toBe(60);
    expect(DEN_ACTIVITY_STREAM_RATE_LIMIT.limit).toBeGreaterThanOrEqual(10);
  });
});
