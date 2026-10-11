import { beforeEach, describe, expect, mock, test } from "bun:test";

import {
  createMessageChangeCursor,
  readMessageChangeCursor,
} from "@/lib/messages/change-cursor";

import { GET } from "./route";

const secret = "message-changes-route-secret";
const mockGetSession = mock(() => ({ user: { id: "user-1" } }));
const mockGetConversation = mock(() => ({
  members: [
    {
      createdAt: new Date("2026-01-01T00:00:00Z"),
      leftAt: null,
      userId: "user-1",
    },
  ],
  membershipSeq: 4,
  type: "DM",
}));
const mockRateLimit = mock(() =>
  Promise.resolve({
    allowed: true,
    remaining: 119,
    resetAt: 0,
    retryAfterSeconds: 0,
  })
);
const mockSequence = mock(() => ({ changeSeq: 150 }));
const mockRecovery = mock(() => ({ recoveryGeneration: 2 }));
const mockReadChanges = mock(
  (_input: {
    afterSequence: number;
    conversationId: string;
    limit: number;
    membershipWindows: { after: Date | null; before: Date | null }[];
    snapshotSequence: number;
    userId: string;
  }) => Promise.resolve([] as Record<string, unknown>[])
);
const mockMembershipEvents = mock(() => Promise.resolve([]));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));
mock.module("@/lib/messages/server", () => ({
  getConversationForUser: mockGetConversation,
}));
mock.module("@asm/db", () => ({
  consumeRateLimit: mockRateLimit,
  fromPrismaDateTime: (value: Date) => value,
  keys: { VIEWER_HASH_SECRET: secret },
  listDenMembershipEvents: mockMembershipEvents,
  listMessageConversationChanges: mockReadChanges,
  prisma: {
    orm: {
      public: {
        MessageConversations: {
          select: () => ({ where: () => ({ first: mockSequence }) }),
        },
        MessageSearchAccountState: {
          select: () => ({ where: () => ({ first: mockRecovery }) }),
        },
      },
    },
  },
}));

function changesRequest(cursor?: string, user = true): Request {
  if (!user) {
    mockGetSession.mockReturnValueOnce(null);
  }
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return new Request(
    `http://localhost/api/messages/conversations/conversation-1/changes${query}`
  );
}

const context = { params: Promise.resolve({ id: "conversation-1" }) };
const scope = {
  conversationId: "conversation-1",
  membershipSequence: 4,
  recoveryGeneration: 2,
  userId: "user-1",
};
const persistedStartCursor = createMessageChangeCursor(
  { ...scope, afterSequence: 0, snapshotSequence: 150 },
  secret
);

describe("GET /api/messages/conversations/:id/changes", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockReturnValue({ user: { id: "user-1" } });
    mockGetConversation.mockReset();
    mockGetConversation.mockReturnValue({
      members: [
        {
          createdAt: new Date("2026-01-01T00:00:00Z"),
          leftAt: null,
          userId: "user-1",
        },
      ],
      membershipSeq: 4,
      type: "DM",
    });
    mockRateLimit.mockReset();
    mockRateLimit.mockReturnValue(
      Promise.resolve({
        allowed: true,
        remaining: 119,
        resetAt: 0,
        retryAfterSeconds: 0,
      })
    );
    mockSequence.mockReturnValue({ changeSeq: 150 });
    mockRecovery.mockReturnValue({ recoveryGeneration: 2 });
    mockReadChanges.mockReset();
    mockReadChanges.mockReturnValue(Promise.resolve([]));
    mockMembershipEvents.mockReset();
    mockMembershipEvents.mockReturnValue(Promise.resolve([]));
  });

  test("requires an authenticated conversation member", async () => {
    const unauthorized = await GET(changesRequest(undefined, false), context);
    expect(unauthorized.status).toBe(401);
    mockGetConversation.mockReturnValueOnce(null);
    const notFound = await GET(changesRequest(), context);
    expect(notFound.status).toBe(404);
  });

  test("seeds new devices at the current sequence without replaying the archive", async () => {
    const response = await GET(changesRequest(), context);
    const body = await response.json();
    const cursor = readMessageChangeCursor(body.nextCursor, scope, secret);

    expect(body).toMatchObject({
      changes: [],
      resetRequired: true,
      snapshotSequence: 150,
    });
    expect(cursor.status).toBe("valid");
    if (cursor.status === "valid") {
      expect(cursor.cursor.afterSequence).toBe(150);
    }
    expect(mockReadChanges).not.toHaveBeenCalled();
  });

  test("returns revision-aware change metadata without message content", async () => {
    mockReadChanges.mockReturnValueOnce(
      Promise.resolve([
        {
          audienceUserIds: ["user-1"],
          conversationId: "conversation-1",
          createdAt: new Date("2026-01-02T00:00:00Z"),
          globallyDeleted: false,
          hiddenForViewer: true,
          id: "change-1",
          kind: "message.hidden",
          messageId: "message-1",
          revision: 1,
          sequence: 12,
          sourceAvailable: true,
          sourceRevision: 2,
        },
      ])
    );

    const response = await GET(changesRequest(persistedStartCursor), context);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.changes).toEqual([
      {
        globallyDeleted: false,
        hiddenForViewer: true,
        id: "change-1",
        kind: "message.hidden",
        messageId: "message-1",
        revision: 1,
        sequence: 12,
        sourceAvailable: true,
        sourceRevision: 2,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("audienceUserIds");
    expect(JSON.stringify(body)).not.toContain("ciphertext");
  });

  test("pins pagination to one snapshot and advances only after all rows settle", async () => {
    mockReadChanges.mockReturnValueOnce(
      Promise.resolve(
        Array.from({ length: 101 }, (_, index) => ({
          audienceUserIds: ["user-1"],
          conversationId: "conversation-1",
          createdAt: new Date("2026-01-02T00:00:00Z"),
          id: `change-${index + 1}`,
          kind: "message.edited",
          messageId: `message-${index + 1}`,
          revision: 2,
          sequence: index + 1,
        }))
      )
    );

    const first = await GET(changesRequest(persistedStartCursor), context);
    const firstBody = await first.json();
    expect(firstBody.changes).toHaveLength(100);
    const firstCursor = readMessageChangeCursor(
      firstBody.nextCursor,
      scope,
      secret
    );
    expect(firstCursor.status).toBe("valid");
    if (firstCursor.status !== "valid") {
      throw new Error("expected a valid continuation cursor");
    }
    expect(firstCursor.cursor.afterSequence).toBe(100);
    expect(firstCursor.cursor.snapshotSequence).toBe(150);

    mockReadChanges.mockReturnValueOnce(
      Promise.resolve([
        {
          audienceUserIds: ["user-1"],
          conversationId: "conversation-1",
          createdAt: new Date("2026-01-02T00:00:00Z"),
          id: "change-101",
          kind: "message.edited",
          messageId: "message-101",
          revision: 2,
          sequence: 101,
        },
      ])
    );
    const second = await GET(changesRequest(firstBody.nextCursor), context);
    const secondBody = await second.json();
    expect(secondBody.changes).toHaveLength(1);
    expect(secondBody.snapshotSequence).toBe(150);
    expect(mockReadChanges).toHaveBeenLastCalledWith(
      expect.objectContaining({ afterSequence: 100, snapshotSequence: 150 })
    );
  });

  test("requests a cache reset when the permission scope has changed", async () => {
    const staleCursor = createMessageChangeCursor(
      { ...scope, afterSequence: 20, snapshotSequence: 30 },
      secret
    );
    mockGetConversation.mockReturnValueOnce({
      members: [
        {
          createdAt: new Date("2026-01-01T00:00:00Z"),
          leftAt: null,
          userId: "user-1",
        },
      ],
      membershipSeq: 5,
      type: "DM",
    });

    const response = await GET(changesRequest(staleCursor), context);
    const body = await response.json();

    expect(body.resetRequired).toBe(true);
    expect(body.changes).toEqual([]);
    expect(mockReadChanges).not.toHaveBeenCalled();
  });

  test("returns a retryable failure if the durable log is unavailable", async () => {
    mockReadChanges.mockReturnValueOnce(
      Promise.reject(new Error("database unavailable"))
    );

    const response = await GET(changesRequest(persistedStartCursor), context);

    expect(response.status).toBe(503);
  });
});
