import { beforeEach, describe, expect, mock, test } from "bun:test";

import { MAX_BATCH_RESPONSE_BYTES, POST } from "./route";

const mockSession = mock(() => ({ user: { id: "user-1" } }));
const mockConversation = mock(() => ({
  members: [
    {
      createdAt: new Date("2026-01-01T00:00:00Z"),
      leftAt: null,
      userId: "user-1",
    },
  ],
  type: "DM",
}));
const mockRateLimit = mock(() =>
  Promise.resolve({ allowed: true, retryAfterSeconds: 0 })
);
const mockHydrate = mock(
  (_input: {
    conversationId: string;
    membershipWindows: { after: Date | null; before: Date | null }[];
    messages: { id: string; revision: number }[];
    userId: string;
  }) => Promise.resolve([] as Record<string, unknown>[])
);
const mockMembershipEvents = mock(() => Promise.resolve([]));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockSession,
}));
mock.module("@/lib/messages/server", () => ({
  getConversationForUser: mockConversation,
}));
mock.module("@asm/db", () => ({
  consumeRateLimit: mockRateLimit,
  fromPrismaDateTime: (value: Date) => value,
  hydrateSearchMessageCandidates: mockHydrate,
  listDenMembershipEvents: mockMembershipEvents,
}));

const context = { params: Promise.resolve({ id: "conversation-1" }) };

function hydrationRequest(
  messages: { id: string; revision: number }[] = [
    { id: "message-1", revision: 1 },
  ]
): Request {
  return new Request(
    "http://localhost/api/messages/conversations/conversation-1/messages/batch",
    {
      body: JSON.stringify({ messages }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );
}

function row(id: string, ciphertext = "sealed") {
  return {
    ciphertext,
    createdAt: new Date("2026-01-02T00:00:00Z"),
    id,
    iv: "iv",
    keyEpoch: 2,
    ratchetIndex: 4,
    revision: 1,
    senderId: "peer-1",
  };
}

describe("POST /api/messages/conversations/:id/messages/batch", () => {
  beforeEach(() => {
    mockSession.mockReset();
    mockSession.mockReturnValue({ user: { id: "user-1" } });
    mockConversation.mockReset();
    mockConversation.mockReturnValue({
      members: [
        {
          createdAt: new Date("2026-01-01T00:00:00Z"),
          leftAt: null,
          userId: "user-1",
        },
      ],
      type: "DM",
    });
    mockRateLimit.mockReset();
    mockRateLimit.mockReturnValue(
      Promise.resolve({ allowed: true, retryAfterSeconds: 0 })
    );
    mockHydrate.mockReset();
    mockHydrate.mockReturnValue(Promise.resolve([]));
    mockMembershipEvents.mockReset();
    mockMembershipEvents.mockReturnValue(Promise.resolve([]));
  });

  test("requires an authenticated conversation member", async () => {
    mockSession.mockReturnValueOnce(null);
    const unauthorized = await POST(hydrationRequest(), context);
    expect(unauthorized.status).toBe(401);
    mockConversation.mockReturnValueOnce(null);
    const notFound = await POST(hydrationRequest(), context);
    expect(notFound.status).toBe(404);
  });

  test("validates a bounded set of unique revision-scoped ids", async () => {
    const emptyBatch = await POST(hydrationRequest([]), context);
    expect(emptyBatch.status).toBe(400);
    const oversizedBatch = await POST(
      hydrationRequest(
        Array.from({ length: 21 }, (_, index) => ({
          id: `message-${index}`,
          revision: 1,
        }))
      ),
      context
    );
    expect(oversizedBatch.status).toBe(400);
    const duplicateIds = await POST(
      hydrationRequest([
        { id: "message-1", revision: 1 },
        { id: "message-1", revision: 2 },
      ]),
      context
    );
    expect(duplicateIds.status).toBe(400);
    const invalidRevision = await POST(
      hydrationRequest([{ id: "message-1", revision: 0 }]),
      context
    );
    expect(invalidRevision.status).toBe(400);
  });

  test("returns only currently readable rows and records unavailable hits", async () => {
    mockHydrate.mockReturnValueOnce(Promise.resolve([row("message-1")]));
    const response = await POST(
      hydrationRequest([
        { id: "message-1", revision: 1 },
        { id: "hidden-or-edited", revision: 4 },
      ]),
      context
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as {
      deferredIds: string[];
      messages: Record<string, unknown>[];
      unavailableIds: string[];
    };
    expect(body).toEqual({
      deferredIds: [],
      messages: [
        { ...row("message-1"), createdAt: "2026-01-02T00:00:00.000Z" },
      ],
      unavailableIds: ["hidden-or-edited"],
    });
    expect(mockHydrate).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        messages: [
          { id: "message-1", revision: 1 },
          { id: "hidden-or-edited", revision: 4 },
        ],
        userId: "user-1",
      })
    );
  });

  test("caps response bytes and returns continuation ids for the next batch", async () => {
    mockHydrate.mockReturnValueOnce(
      Promise.resolve([
        row("message-1", "a".repeat(700_000)),
        row("message-2", "b".repeat(500_000)),
      ])
    );
    const response = await POST(
      hydrationRequest([
        { id: "message-1", revision: 1 },
        { id: "message-2", revision: 1 },
      ]),
      context
    );
    const raw = await response.text();
    const body = JSON.parse(raw) as {
      deferredIds: string[];
      messages: { ciphertext: string; id: string }[];
      unavailableIds: string[];
    };

    expect(response.status).toBe(200);
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(
      MAX_BATCH_RESPONSE_BYTES
    );
    expect(body.messages.map((message) => message.id)).toEqual(["message-1"]);
    expect(body.deferredIds).toEqual(["message-2"]);
    expect(body.unavailableIds).toEqual([]);
  });

  test("returns a retryable failure when the hydration store is unavailable", async () => {
    mockHydrate.mockReturnValueOnce(
      Promise.reject(new Error("db unavailable"))
    );
    const response = await POST(hydrationRequest(), context);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Search results are temporarily unavailable. Please try again.",
    });
  });
});
