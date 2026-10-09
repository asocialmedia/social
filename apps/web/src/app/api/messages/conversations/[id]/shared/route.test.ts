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
    hasUnreadableMessages: false,
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
const referenceInputs: Record<string, unknown>[] = [];

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockSession,
}));
mock.module("@/lib/messages/server", () => ({
  getConversationForUser: mockConversation,
}));
const mockEpochCoverage = mock(() =>
  Promise.resolve({ pending: 0, unavailable: 0 })
);
mock.module("@asm/db", () => ({
  consumeRateLimit: mockRateLimit,
  enqueueMessageSearchBackfill: mockEnqueueBackfill,
  fromPrismaDateTime: (value: Date) => value,
  keys: { VIEWER_HASH_SECRET: "shared-ref-test-secret" },
  listDenMembershipEvents: mockMembershipEvents,
  listMessageSearchReferences: (input: Record<string, unknown>) => {
    referenceInput = input;
    referenceInputs.push(input);
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
  readMessageSearchViewerEpochCoverage: mockEpochCoverage,
  startMessageSearchBackfill: mockStartBackfill,
}));

const context = { params: Promise.resolve({ id: "conversation-1" }) };

function request(url = "?kind=media&limit=1"): Request {
  return new Request(
    `http://localhost/api/messages/conversations/conversation-1/shared${url}`
  );
}

function referenceRow(messageId: string, second: number, ordinal = 0) {
  return {
    createdAt: new Date(`2026-10-08T10:00:0${second}.000Z`),
    keyEpoch: 1,
    mediaKind: "image",
    messageId,
    ordinal,
    ratchetIndex: second,
    requiredId: `media-${messageId}`,
    revision: 1,
    senderId: "user-1",
  };
}

describe("GET /api/messages/conversations/:id/shared", () => {
  beforeEach(() => {
    mockEpochCoverage.mockReset();
    mockEpochCoverage.mockResolvedValue({ pending: 0, unavailable: 0 });
    process.env.MESSAGE_SEARCH_BACKFILL_ENABLED = "1";
    process.env.MESSAGE_SEARCH_COUNT_ENABLED = "1";
    process.env.MESSAGE_SEARCH_SERVER_ENABLED = "1";
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
    mockStartBackfill.mockClear();
    mockEnqueueBackfill.mockClear();
    referenceInput = undefined;
    referenceInputs.length = 0;
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
      coveragePaused: false,
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

  test("keeps reference coverage incomplete while the viewer's epochs are unverified", async () => {
    mockEpochCoverage.mockResolvedValue({ pending: 1, unavailable: 0 });
    const response = await GET(request(), context);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      coverageComplete: false,
      coverageSettled: false,
    });
  });

  test("marks partial shared history paused when backfill is disabled", async () => {
    process.env.MESSAGE_SEARCH_BACKFILL_ENABLED = "0";
    mockCoverage.mockReturnValueOnce(
      Promise.resolve({
        backfillCompletedAt: null,
        completedChangeSeq: 20,
        unrecoverableEpochs: 0,
      })
    );

    const response = await GET(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      coverageComplete: false,
      coveragePaused: true,
      coverageSettled: false,
    });
    expect(mockStartBackfill).not.toHaveBeenCalled();
    expect(mockEnqueueBackfill).not.toHaveBeenCalled();
  });

  test("distinguishes finished indexing from complete references when keys are unavailable", async () => {
    mockCoverage.mockReturnValueOnce(
      Promise.resolve({
        backfillCompletedAt: new Date("2026-10-08T11:00:00.000Z"),
        completedChangeSeq: 80,
        unrecoverableEpochs: 2,
      })
    );

    const response = await GET(request(), context);
    const body = await response.json();

    expect(body).toMatchObject({
      coverageComplete: false,
      coverageSettled: true,
    });
  });

  test("keeps shared coverage incomplete for unreadable rows with no known epoch", async () => {
    mockCoverage.mockReturnValueOnce(
      Promise.resolve({
        backfillCompletedAt: new Date("2026-10-08T11:00:00.000Z"),
        completedChangeSeq: 80,
        hasUnreadableMessages: true,
        unrecoverableEpochs: 0,
      })
    );

    const response = await GET(request(), context);
    const body = await response.json();

    expect(body).toMatchObject({
      coverageComplete: false,
      coverageSettled: true,
    });
  });

  test("returns a bounded window around an anchor with cursors in both directions", async () => {
    mockListReferences
      .mockImplementationOnce(() =>
        Promise.resolve([
          referenceRow("older-near", 1),
          referenceRow("older-far", 0),
        ])
      )
      .mockImplementationOnce(() =>
        Promise.resolve([
          referenceRow("newer-near", 3),
          referenceRow("newer-far", 4),
          referenceRow("newer-extra", 5),
        ])
      );
    const response = await GET(
      request(
        "?kind=media&limit=4&aroundMessageId=anchor&aroundCreatedAt=2026-10-08T10%3A00%3A02.000Z&aroundOrdinal=0"
      ),
      context
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      hasMore: true,
      window: {
        hasNewer: true,
        hasOlder: true,
      },
    });
    expect(body.window.newerCursor).toEqual(expect.any(String));
    expect(body.window.olderCursor).toEqual(expect.any(String));
    expect(
      body.items.map((item: { messageId: string }) => item.messageId)
    ).toEqual(["newer-far", "newer-near", "older-near"]);
    expect(referenceInputs).toHaveLength(2);
    expect(referenceInputs[0]).toMatchObject({
      after: {
        createdAt: new Date("2026-10-08T10:00:02.000Z"),
        messageId: "anchor",
        ordinal: 0,
      },
      limit: 2,
    });
    expect(referenceInputs[1]).toMatchObject({
      before: {
        createdAt: new Date("2026-10-08T10:00:02.000Z"),
        messageId: "anchor",
        ordinal: 0,
      },
      limit: 3,
    });
    const newerCursor = body.window.newerCursor as string;
    mockListReferences.mockReturnValue(
      Promise.resolve([
        referenceRow("newest-1", 7),
        referenceRow("newest-2", 6),
      ])
    );
    const nextResponse = await GET(
      request(`?kind=media&limit=4&cursor=${encodeURIComponent(newerCursor)}`),
      context
    );
    const nextBody = await nextResponse.json();
    expect(referenceInputs[2]).toMatchObject({
      before: {
        messageId: "newer-far",
      },
      snapshotSequence: 80,
    });
    expect(
      nextBody.items.map((item: { messageId: string }) => item.messageId)
    ).toEqual(["newest-2", "newest-1"]);
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
