import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

const mockSession = mock(() => ({ user: { id: "user-1" } }));
const mockConversation = mock(() => ({
  members: [
    {
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      leftAt: null,
      userId: "user-1",
    },
  ],
  membershipSeq: 4,
  type: "DM",
}));
const mockRateLimit = mock(() =>
  Promise.resolve({ allowed: true, retryAfterSeconds: 0 })
);
const mockListReferences = mock(() => Promise.resolve([] as object[]));
const mockSequence = mock(() => Promise.resolve({ changeSeq: 80 }));
const mockRecoveryState = mock(() =>
  Promise.resolve({ recoveryGeneration: 2 })
);
const mockMembershipEvents = mock(() => Promise.resolve([]));
const mockCoverage = mock(() =>
  Promise.resolve({
    backfillCompletedAt: new Date("2026-10-08T11:00:00.000Z"),
    completedChangeSeq: 80,
    unrecoverableEpochs: 0,
  })
);
const mockStartBackfill = mock(() =>
  Promise.resolve({
    completedAt: new Date("2026-10-08T11:00:00.000Z"),
    expectedPosition: { createdAt: null, messageId: null },
    throughSequence: 80,
  })
);
const mockEnqueueBackfill = mock(() => Promise.resolve());
let referenceInput: Record<string, unknown> | undefined;

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockSession,
}));
mock.module("@/lib/messages/server", () => ({
  getConversationForUser: mockConversation,
}));
mock.module("@asm/db", () => ({
  consumeRateLimit: mockRateLimit,
  enqueueMessageSearchBackfill: mockEnqueueBackfill,
  fromPrismaDateTime: (value: Date) => value,
  keys: { VIEWER_HASH_SECRET: "shared-ref-test-secret" },
  listDenMembershipEvents: mockMembershipEvents,
  listMessageSearchReferences: (input: Record<string, unknown>) => {
    referenceInput = input;
    return mockListReferences();
  },
  prisma: {
    orm: {
      public: {
        MessageConversations: {
          select: () => ({ where: () => ({ first: mockSequence }) }),
        },
        MessageSearchAccountState: {
          select: () => ({ where: () => ({ first: mockRecoveryState }) }),
        },
        MessageSearchCoverage: {
          select: () => ({ where: () => ({ first: mockCoverage }) }),
        },
      },
    },
  },
  startMessageSearchBackfill: mockStartBackfill,
}));

const context = { params: Promise.resolve({ id: "conversation-1" }) };

function request(url = "?kind=media&limit=1"): Request {
  return new Request(
    `http://localhost/api/messages/conversations/conversation-1/shared${url}`
  );
}

describe("GET /api/messages/conversations/:id/shared", () => {
  beforeEach(() => {
    mockSession.mockReset();
    mockSession.mockReturnValue({ user: { id: "user-1" } });
    mockConversation.mockReset();
    mockConversation.mockReturnValue({
      members: [
        {
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          leftAt: null,
          userId: "user-1",
        },
      ],
      membershipSeq: 4,
      type: "DM",
    });
    mockRateLimit.mockReset();
    mockRateLimit.mockReturnValue(
      Promise.resolve({ allowed: true, retryAfterSeconds: 0 })
    );
    mockListReferences.mockReset();
    mockListReferences.mockReturnValue(Promise.resolve([]));
    mockSequence.mockReturnValue(Promise.resolve({ changeSeq: 80 }));
    mockRecoveryState.mockReturnValue(
      Promise.resolve({ recoveryGeneration: 2 })
    );
    mockMembershipEvents.mockReturnValue(Promise.resolve([]));
    mockCoverage.mockReturnValue(
      Promise.resolve({
        backfillCompletedAt: new Date("2026-10-08T11:00:00.000Z"),
        completedChangeSeq: 80,
        unrecoverableEpochs: 0,
      })
    );
    mockStartBackfill.mockReturnValue(
      Promise.resolve({
        completedAt: new Date("2026-10-08T11:00:00.000Z"),
        expectedPosition: { createdAt: null, messageId: null },
        throughSequence: 80,
      })
    );
    mockEnqueueBackfill.mockReturnValue(Promise.resolve());
    referenceInput = undefined;
  });

  test("returns a bounded page and a signed cursor scoped to the viewer", async () => {
    mockListReferences.mockReturnValue(
      Promise.resolve([
        {
          createdAt: new Date("2026-10-08T10:00:00.000Z"),
          mediaKind: "image",
          messageId: "message-1",
          ordinal: 0,
          requiredId: "media-1",
          revision: 3,
        },
        {
          createdAt: new Date("2026-10-08T09:00:00.000Z"),
          mediaKind: "gif",
          messageId: "message-2",
          ordinal: 1,
          requiredId: "media-2",
          revision: 2,
        },
      ])
    );
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      coverageComplete: true,
      hasMore: true,
      snapshotSequence: 80,
    });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      kind: "media",
      messageId: "message-1",
      requiredId: "media-1",
      revision: 3,
    });
    expect(typeof body.nextCursor).toBe("string");
    expect(referenceInput).toMatchObject({
      conversationId: "conversation-1",
      kind: "media",
      limit: 2,
      snapshotSequence: 80,
      userId: "user-1",
    });
  });

  test("keeps pagination on its original snapshot when new changes arrive", async () => {
    mockListReferences.mockReturnValue(
      Promise.resolve([
        {
          createdAt: new Date("2026-10-08T10:00:00.000Z"),
          mediaKind: "image",
          messageId: "message-1",
          ordinal: 0,
          requiredId: "media-1",
          revision: 3,
        },
        {
          createdAt: new Date("2026-10-08T09:00:00.000Z"),
          mediaKind: "image",
          messageId: "message-2",
          ordinal: 0,
          requiredId: "media-2",
          revision: 1,
        },
      ])
    );
    const firstResponse = await GET(request(), context);
    const first = await firstResponse.json();
    mockSequence.mockReturnValue(Promise.resolve({ changeSeq: 99 }));
    await GET(
      request(
        `?kind=media&limit=1&cursor=${encodeURIComponent(first.nextCursor ?? "")}`
      ),
      context
    );
    expect(referenceInput).toMatchObject({
      after: {
        createdAt: new Date("2026-10-08T10:00:00.000Z"),
        messageId: "message-1",
        ordinal: 0,
      },
      snapshotSequence: 80,
    });
  });

  test("rejects unauthorized, invalid type, and malformed cursor requests", async () => {
    mockSession.mockReturnValueOnce(null);
    const unauthorized = await GET(request(), context);
    const invalidKind = await GET(request("?kind=other"), context);
    const invalidCursor = await GET(
      request("?kind=media&cursor=invalid"),
      context
    );
    expect(unauthorized.status).toBe(401);
    expect(invalidKind.status).toBe(400);
    expect(invalidCursor.status).toBe(400);
  });

  test("fails closed when the conversation is no longer available", async () => {
    mockConversation.mockReturnValueOnce(null);
    const response = await GET(request(), context);
    expect(response.status).toBe(404);
  });

  test("preserves a departed den member's bounded read window", async () => {
    const leftAt = new Date("2026-02-01T00:00:00.000Z");
    mockConversation.mockReturnValueOnce({
      members: [
        {
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          leftAt,
          userId: "user-1",
        },
      ],
      membershipSeq: 5,
      type: "DEN",
    });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(mockMembershipEvents).toHaveBeenCalledWith("conversation-1", leftAt);
    expect(referenceInput).toMatchObject({
      membershipWindows: [
        { after: new Date("2026-01-01T00:00:00.000Z"), before: leftAt },
      ],
    });
  });
});
