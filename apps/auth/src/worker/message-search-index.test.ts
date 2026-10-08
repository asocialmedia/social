import { beforeEach, describe, expect, mock, test } from "bun:test";

const mockOutboxFirst = mock(() => Promise.resolve(outbox));
const mockMessageFirst = mock(() => Promise.resolve(message));
const mockLoadMembers = mock(() => Promise.resolve([{ userId: "user-happy" }]));
const mockLoadConversation = mock(() => Promise.resolve({ _type: "DM" }));
const mockLoadIdentities = mock(() => Promise.resolve([identity]));
const mockLoadWraps = mock(() => Promise.resolve([wrap]));
const mockPersistDocument = mock(() => Promise.resolve());
const mockMarkUnreadable = mock(() => Promise.resolve());
const mockStartBackfill = mock(() => Promise.resolve(backfillState));
const mockReadBackfill = mock(() => Promise.resolve(backfillBatch));
const mockCommitBackfill = mock(() => Promise.resolve({ committed: true }));
const mockLoggerWarn = mock();
const mockLoggerError = mock();

let outbox = {
  changeSequence: 8,
  completedAt: null as Date | null,
  conversationId: "conversation-1",
  id: "outbox-1",
  kind: "upsert",
  messageId: "message-1",
  revision: 3,
};
let message = {
  ciphertext: "ciphertext",
  createdAt: new Date("2026-10-08T10:00:00.000Z"),
  deletedAt: null as Date | null,
  id: "message-1",
  iv: "message-iv",
  keyEpoch: 1 as number | null,
  ratchetIndex: 4,
  revision: 3,
  senderId: "user-happy",
};
let identity: {
  encryptedPrivateKey: string;
  kdfIterations: number;
  masterKeyHash: string | null;
  publicKey: string;
  salt: string;
  updatedAt: Date;
  userId: string;
} = {
  encryptedPrivateKey: "private-iv.private-ciphertext",
  kdfIterations: 210_000,
  masterKeyHash: "a".repeat(64),
  publicKey: "stored-public-key",
  salt: "c2FsdC1zYWx0LXNlZWRzLWFyZS1sb25nLXNlY3VyZQ==",
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  userId: "user-happy",
};
let wrap = {
  conversationId: "conversation-1",
  encryptedKey: "wrapped-root",
  iv: "wrap-iv",
  ownerUserId: "user-happy",
  version: 1,
  wrapperPublicKey: "wrapper-public-key",
  wrapperUserId: "user-peer",
};
let backfillState = {
  completedAt: null as Date | null,
  expectedPosition: { createdAt: null as Date | null, messageId: null },
  throughSequence: 10 as number | null,
};
let backfillBatch = {
  expectedPosition: { createdAt: null as Date | null, messageId: null },
  messages: [message],
  throughSequence: 10,
};

mock.module("@asm/db", () => ({
  commitMessageSearchBackfillBatch: mockCommitBackfill,
  markSearchOutboxUnreadable: mockMarkUnreadable,
  persistSearchDocument: mockPersistDocument,
  prisma: {
    orm: {
      public: {
        MessageConversationKeys: {
          where: () => ({ all: mockLoadWraps }),
        },
        MessageConversationMembers: {
          select: () => ({ where: () => ({ all: mockLoadMembers }) }),
        },
        MessageConversations: {
          select: () => ({ where: () => ({ first: mockLoadConversation }) }),
        },
        MessageIdentities: {
          where: () => ({ all: mockLoadIdentities }),
        },
        MessageSearchOutbox: {
          where: () => ({ first: mockOutboxFirst }),
        },
        Messages: {
          where: () => ({ first: mockMessageFirst }),
        },
      },
    },
  },
  readNextMessageSearchBackfillBatch: mockReadBackfill,
  startMessageSearchBackfill: mockStartBackfill,
}));

mock.module("@asm/messages", () => ({
  decryptMessage: mock(
    (
      _rootKey: unknown,
      _senderId: string,
      _conversationId: string,
      payload: unknown
    ) => Promise.resolve({ payload })
  ),
  decryptWithMasterKey: mock(() =>
    Promise.resolve('{"kty":"EC","crv":"P-256"}')
  ),
  deriveMasterKey: mock(() => Promise.resolve("master-key")),
  importPrivateKeyJwk: mock(() => Promise.resolve({ kind: "private-key" })),
  importPublicKeyJwk: mock(() => Promise.resolve({ kind: "public-key" })),
  messageSearchGramKeys: mock((value: string) => [`gram:${value}`]),
  messageSearchTerms: mock((value: string) => [value.toLocaleLowerCase()]),
  publicKeyBase64ToJwk: mock((value: string) => ({ key: value, kty: "EC" })),
  searchableTextFromPayload: mock(() => "Needle in a message"),
  unwrapRootKey: mock(() => Promise.resolve("root-key")),
}));

describe("message search indexing worker", () => {
  beforeEach(() => {
    outbox = {
      changeSequence: 8,
      completedAt: null,
      conversationId: "conversation-1",
      id: "outbox-1",
      kind: "upsert",
      messageId: "message-1",
      revision: 3,
    };
    message = {
      ciphertext: "ciphertext",
      createdAt: new Date("2026-10-08T10:00:00.000Z"),
      deletedAt: null,
      id: "message-1",
      iv: "message-iv",
      keyEpoch: 1,
      ratchetIndex: 4,
      revision: 3,
      senderId: "user-happy",
    };
    identity = {
      encryptedPrivateKey: "private-iv.private-ciphertext",
      kdfIterations: 210_000,
      masterKeyHash: "a".repeat(64),
      publicKey: "stored-public-key",
      salt: "c2FsdC1zYWx0LXNlZWRzLWFyZS1sb25nLXNlY3VyZQ==",
      updatedAt: new Date("2026-10-01T00:00:00.000Z"),
      userId: "user-happy",
    };
    wrap = {
      conversationId: "conversation-1",
      encryptedKey: "wrapped-root",
      iv: "wrap-iv",
      ownerUserId: "user-happy",
      version: 1,
      wrapperPublicKey: "wrapper-public-key",
      wrapperUserId: "user-peer",
    };
    backfillState = {
      completedAt: null,
      expectedPosition: { createdAt: null, messageId: null },
      throughSequence: 10,
    };
    backfillBatch = {
      expectedPosition: { createdAt: null, messageId: null },
      messages: [message],
      throughSequence: 10,
    };
    for (const fn of [
      mockOutboxFirst,
      mockMessageFirst,
      mockLoadMembers,
      mockLoadConversation,
      mockLoadIdentities,
      mockLoadWraps,
      mockPersistDocument,
      mockMarkUnreadable,
      mockStartBackfill,
      mockReadBackfill,
      mockCommitBackfill,
      mockLoggerWarn,
      mockLoggerError,
    ]) {
      fn.mockReset();
    }
    mockOutboxFirst.mockImplementation(() => Promise.resolve(outbox));
    mockMessageFirst.mockImplementation(() => Promise.resolve(message));
    mockLoadMembers.mockReturnValue(
      Promise.resolve([{ userId: identity.userId }])
    );
    mockLoadConversation.mockReturnValue(Promise.resolve({ _type: "DM" }));
    mockLoadIdentities.mockReturnValue(Promise.resolve([identity]));
    mockLoadWraps.mockReturnValue(Promise.resolve([wrap]));
    mockPersistDocument.mockReturnValue(Promise.resolve());
    mockMarkUnreadable.mockReturnValue(Promise.resolve());
    mockStartBackfill.mockReturnValue(Promise.resolve(backfillState));
    mockReadBackfill.mockReturnValue(Promise.resolve(backfillBatch));
    mockCommitBackfill.mockReturnValue(Promise.resolve({ committed: true }));
  });

  test("decrypts transiently and atomically persists only normalized terms", async () => {
    const { processMessageSearchOutbox } =
      await import("./message-search-index");
    await processMessageSearchOutbox("outbox-1", { warn: mockLoggerWarn });

    expect(mockPersistDocument).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      keyEpoch: 1,
      messageId: "message-1",
      outboxId: "outbox-1",
      revision: 3,
      terms: [
        {
          gramKeys: ["gram:needle in a message"],
          normalized: "needle in a message",
        },
      ],
    });
    expect(mockMarkUnreadable).not.toHaveBeenCalled();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  test("settles stale and deleted revisions as empty documents without decrypting", async () => {
    const { processMessageSearchOutbox } =
      await import("./message-search-index");
    message = { ...message, revision: 4 };

    await processMessageSearchOutbox("outbox-1", { warn: mockLoggerWarn });

    expect(mockPersistDocument).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      keyEpoch: 1,
      messageId: "message-1",
      outboxId: "outbox-1",
      revision: 3,
      terms: [],
    });

    message = { ...message, deletedAt: new Date() };
    await processMessageSearchOutbox("outbox-1", { warn: mockLoggerWarn });
    expect(mockPersistDocument).toHaveBeenNthCalledWith(2, {
      conversationId: "conversation-1",
      keyEpoch: 1,
      messageId: "message-1",
      outboxId: "outbox-1",
      revision: 3,
      terms: [],
    });
    expect(mockLoadMembers).not.toHaveBeenCalled();
  });

  test("records an unreadable epoch without logging plaintext or key material", async () => {
    const { processMessageSearchOutbox } =
      await import("./message-search-index");
    identity = {
      ...identity,
      masterKeyHash: null,
      updatedAt: new Date("2026-10-02T00:00:00.000Z"),
    };
    mockLoadMembers.mockReturnValue(
      Promise.resolve([{ userId: identity.userId }])
    );
    mockLoadIdentities.mockReturnValue(Promise.resolve([identity]));

    await processMessageSearchOutbox("outbox-1", { warn: mockLoggerWarn });

    expect(mockMarkUnreadable).toHaveBeenCalledWith({
      changeSequence: 8,
      conversationId: "conversation-1",
      outboxId: "outbox-1",
      revision: 3,
    });
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      { outboxId: "outbox-1" },
      "DM search item is waiting for a readable message-key epoch"
    );
    expect(mockPersistDocument).not.toHaveBeenCalled();
  });

  test("leaves durable outbox work retryable when persistence fails", async () => {
    const failure = new Error("temporary database failure");
    mockPersistDocument.mockRejectedValueOnce(failure);
    const { processMessageSearchOutbox } =
      await import("./message-search-index");

    await expect(
      processMessageSearchOutbox("outbox-1", { warn: mockLoggerWarn })
    ).rejects.toBe(failure);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  test("indexes a bounded historical batch and advances only after commit", async () => {
    const { processMessageSearchBackfill } =
      await import("./message-search-index");
    const result = await processMessageSearchBackfill("conversation-1", {
      warn: mockLoggerWarn,
    });

    expect(mockCommitBackfill).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        rowsTraversed: 1,
        throughSequence: 10,
        unrecoverableEpochs: 0,
      })
    );
    expect(result).toEqual({
      finished: false,
      nextCursorMessageId: "message-1",
    });
  });

  test("does not enqueue a successor when the backfill cursor compare-and-swap loses", async () => {
    mockCommitBackfill.mockReturnValueOnce(
      Promise.resolve({ committed: false })
    );
    const { processMessageSearchBackfill } =
      await import("./message-search-index");

    await expect(
      processMessageSearchBackfill("conversation-1", { warn: mockLoggerWarn })
    ).resolves.toEqual({ finished: false, nextCursorMessageId: null });
  });

  test("reports a completed or absent backfill without enqueuing a successor", async () => {
    mockStartBackfill.mockReturnValueOnce(
      Promise.resolve({ ...backfillState, completedAt: new Date() })
    );
    const { processMessageSearchBackfill } =
      await import("./message-search-index");

    await expect(
      processMessageSearchBackfill("conversation-1", { warn: mockLoggerWarn })
    ).resolves.toEqual({ finished: true, nextCursorMessageId: null });
    expect(mockReadBackfill).not.toHaveBeenCalled();
  });
});
