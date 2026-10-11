import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DEN_TYPING_RATE_LIMIT } from "@/lib/messages/den-rate-limit";
import { messageRouteLimiter } from "@/lib/messages/test-support/route-limiter-probe";

import { POST } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
type Conversation = { id: string; members: unknown[] } | null;
const mockGetConversationForUser = mock((): Conversation => ({
  id: "convo-1",
  members: [],
}));
const mockPublishTyping = mock(() => {
  limiter.service("publish");
});

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

// The limiter this route charges. Mocked explicitly because bun's
// `mock.module("@asm/db")` does not reach the rules module's own binding on it,
// and an unmocked limiter spends real Redis budget from the test suite.
const limiter = messageRouteLimiter();
mock.module("@/lib/messages/den-rate-limit", () => limiter.module);

mock.module("@/lib/messages/server", () => ({
  getConversationForUser: mockGetConversationForUser,
}));

mock.module("@asm/db", () => ({
  publishTypingStarted: mockPublishTyping,
}));

function postTo(conversationId: string) {
  return POST(new Request(`http://localhost:3000/typing`, { method: "POST" }), {
    params: Promise.resolve({ id: conversationId }),
  });
}

describe("POST /api/messages/conversations/:id/typing", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockGetConversationForUser.mockClear();
    mockPublishTyping.mockClear();
    limiter.reset();
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await postTo("convo-1");
    expect(res.status).toBe(401);
    expect(mockPublishTyping).not.toHaveBeenCalled();
  });

  test("rejects non-members", async () => {
    mockGetConversationForUser.mockReturnValueOnce(null);
    const res = await postTo("convo-1");
    expect(res.status).toBe(404);
    expect(mockPublishTyping).not.toHaveBeenCalled();
  });

  test("publishes a typing event for the user", async () => {
    const res = await postTo("convo-1");
    expect(res.status).toBe(200);
    expect(mockGetConversationForUser).toHaveBeenCalledWith("convo-1", "user1");
    expect(mockPublishTyping).toHaveBeenCalledWith("convo-1", "user1");
  });
});

describe("POST /api/messages/conversations/:id/typing rate limit", () => {
  beforeEach(() => {
    mockGetSession.mockReturnValue({ user: { id: "user1" } });
    mockGetConversationForUser.mockClear();
    mockPublishTyping.mockClear();
    limiter.reset();
  });

  test("spends the typing budget, per account", async () => {
    const res = await postTo("convo-1");
    expect(res.status).toBe(200);
    expect(limiter.chargedBuckets).toEqual([DEN_TYPING_RATE_LIMIT.bucket]);
    expect(limiter.chargedIdentifiers).toEqual(["user1"]);
  });

  test("429s with a retry-after and publishes nothing when over budget", async () => {
    // The property that makes a limiter worth having: a refused heartbeat must
    // not reach the publish. A limiter that ran after the work would be a
    // counter that watches the room burn.
    limiter.setDenied(true);
    const res = await postTo("convo-1");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(mockPublishTyping).not.toHaveBeenCalled();
  });

  test("charges the limiter before it reads the roster", async () => {
    // Typing is the cheapest thing to spam on the surface - one read, one
    // publish, no write - so the gate has to be ahead of the read or the read is
    // the cost the loop actually buys.
    const res = await postTo("convo-1");
    expect(res.status).toBe(200);
    expect(limiter.order).toEqual([
      `consume:${DEN_TYPING_RATE_LIMIT.bucket}`,
      "service:publish",
    ]);
  });

  test("two accounts do not share one budget", async () => {
    await postTo("convo-1");
    mockGetSession.mockReturnValue({ user: { id: "user2" } });
    await postTo("convo-1");
    expect(limiter.chargedIdentifiers).toEqual(["user1", "user2"]);
    // The conversation is the same one for both; only the identity moved, so a
    // bucket keyed by anything else would have collapsed these into one.
    expect(new Set(limiter.chargedIdentifiers).size).toBe(2);
  });
});
