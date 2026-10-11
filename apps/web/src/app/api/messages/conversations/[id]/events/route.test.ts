import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user-1" } }));

// The read gate's answer, and the only thing this route needs from it: the
// viewer's own membership row, whose `leftAt` becomes the log's cutoff.
let conversation: {
  members: { leftAt: Date | null; userId: string }[];
  type: string;
} | null;
const mockListEvents = mock(
  (_conversationId: string, _visibleUntil: Date | null) =>
    Promise.resolve([
      {
        action: "CREATED" as const,
        actorId: "user-1",
        actorName: "Ada",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        id: "e-1",
        targetName: null,
        targetUserId: null,
      },
    ])
);

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/messages/server", () => ({
  getConversationForUser: () => Promise.resolve(conversation),
}));

mock.module("@asm/db", () => ({
  listDenMembershipEvents: mockListEvents,
}));

function get(): Promise<Response> {
  return GET(
    new Request("http://test/api/messages/conversations/convo-1/events"),
    {
      params: Promise.resolve({ id: "convo-1" }),
    }
  );
}

beforeEach(() => {
  mockGetSession.mockImplementation(() => ({ user: { id: "user-1" } }));
  conversation = {
    members: [{ leftAt: null, userId: "user-1" }],
    type: "DEN",
  };
  mockListEvents.mockClear();
});

describe("GET /api/messages/conversations/:id/events", () => {
  test("401s without a session, before reading anything", async () => {
    mockGetSession.mockImplementation(() => null);
    const response = await get();
    expect(response.status).toBe(401);
    expect(mockListEvents).not.toHaveBeenCalled();
  });

  test("404s when the read gate refuses the conversation", async () => {
    conversation = null;
    const response = await get();
    expect(response.status).toBe(404);
    expect(mockListEvents).not.toHaveBeenCalled();
  });

  test("a DM answers an empty log rather than an error", async () => {
    conversation = {
      members: [{ leftAt: null, userId: "user-1" }],
      type: "DM",
    };
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: [] });
    // The log table is den-only, so a DM must not even read it.
    expect(mockListEvents).not.toHaveBeenCalled();
  });

  test("passes the viewer's own leftAt as the cutoff", async () => {
    const leftAt = new Date("2026-02-01T00:00:00.000Z");
    conversation = { members: [{ leftAt, userId: "user-1" }], type: "DEN" };
    const response = await get();
    expect(response.status).toBe(200);
    expect(mockListEvents).toHaveBeenCalledWith("convo-1", leftAt);
  });

  test("serialises dates as ISO strings for the wire", async () => {
    const response = await get();
    const body = (await response.json()) as {
      events: { createdAt: string }[];
    };
    expect(body.events[0]?.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
