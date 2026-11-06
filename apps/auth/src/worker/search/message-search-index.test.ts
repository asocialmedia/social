import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";

import type { MessageSearchWorkerMetricEvent } from "./message-search-metrics";

const mockOutboxFirst = mock(() => Promise.resolve(outbox));
const mockMessageFirst = mock(() => Promise.resolve(message));
const mockLoadMembers = mock(() => Promise.resolve([{ userId: "user-happy" }]));
const mockLoadConversation = mock(() => Promise.resolve({ _type: "DM" }));
const mockLoadIdentities = mock(() => Promise.resolve([identity]));
const mockLoadWraps = mock(() => Promise.resolve([wrap]));
const mockPersistDocument = mock(() =>
  Promise.resolve({ status: "indexed" as const })
);
const mockMarkUnreadable = mock(() => Promise.resolve());
const mockStartBackfill = mock(() => Promise.resolve(backfillState));
const mockReadBackfill = mock(() => Promise.resolve(backfillBatch));
const mockCommitBackfill = mock(() => Promise.resolve({ committed: true }));
const mockLoggerWarn = mock();
const mockLoggerError = mock();
const mockDecryptMessage = mock(
  (
    _rootKey: unknown,
    _senderId: string,
    _conversationId: string,
    payload: unknown
  ) => Promise.resolve({ payload })
);

let outbox = {
  changeSequence: 8,
  completedAt: null as Date | null,
  conversationId: "conversation-1",
  createdAt: new Date("2026-10-08T10:00:00.000Z"),
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
  id: "wrap-1",
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
  fromPrismaDateTime: (value: unknown) =>
    value instanceof Date ? value : new Date(String(value)),
  markSearchOutboxUnreadable: mockMarkUnreadable,
  messageSearchEpochFingerprint: (input: unknown) =>
    createHash("sha256").update(JSON.stringify(input)).digest("hex"),
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
        MessageSearchAccountState: {
          where: () => ({ all: () => Promise.resolve([]) }),
        },
        MessageSearchEpochReadability: {
          where: () => ({ all: () => Promise.resolve([]) }),
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

mock.module("@asm/messages/crypto", () => ({
  decryptMessage: mockDecryptMessage,
  decryptWithMasterKey: mock(() =>
    Promise.resolve(
      '{"kty":"EC","crv":"P-256","d":"private-d","x":"public-x","y":"public-y"}'
    )
  ),
  deriveMasterKey: mock(() => Promise.resolve("master-key")),
  extractMessageReferences: mock(() => [
    {
      kind: "media",
      mediaKind: "image",
      ordinal: 0,
      requiredId: "media_1",
      url: "/api/media/media_1",
    },
  ]),
  importPrivateKeyJwk: mock(() => Promise.resolve({ kind: "private-key" })),
  importPublicKeyJwk: mock(() => Promise.resolve({ kind: "public-key" })),
  publicKeyBase64ToJwk: mock((value: string) => ({
    crv: "P-256",
    key: value,
    kty: "EC",
    x: "public-x",
    y: "public-y",
  })),
  unwrapRootKey: mock(() => Promise.resolve(new Uint8Array(32))),
}));

mock.module("@asm/messages/normalization", () => ({
  messageSearchGramKeys: mock((value: string) => [`gram:${value}`]),
  messageSearchTerms: mock((value: string) => [value.toLocaleLowerCase()]),
}));

mock.module("@asm/messages/search-contracts", () => ({
  searchableTextFromPayload: mock(() => "Needle in a message"),
}));

describe("message search indexing worker", () => {
  beforeEach(() => {
    outbox = {
      changeSequence: 8,
      completedAt: null,
      conversationId: "conversation-1",
      createdAt: new Date("2026-10-08T10:00:00.000Z"),
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
      id: "wrap-1",
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
      mockDecryptMessage,
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
    mockPersistDocument.mockReturnValue(Promise.resolve({ status: "indexed" }));
    mockMarkUnreadable.mockReturnValue(Promise.resolve());
    mockStartBackfill.mockReturnValue(Promise.resolve(backfillState));
    mockReadBackfill.mockReturnValue(Promise.resolve(backfillBatch));
    mockCommitBackfill.mockReturnValue(Promise.resolve({ committed: true }));
    mockDecryptMessage.mockImplementation(
      (
        _rootKey: unknown,
        _senderId: string,
        _conversationId: string,
        payload: unknown
      ) => Promise.resolve({ payload })
    );
  });

  test("decrypts transiently and atomically persists only normalized terms", async () => {
    const { processMessageSearchOutbox } =
      await import("./message-search-index");
    const metrics: MessageSearchWorkerMetricEvent[] = [];
    await processMessageSearchOutbox(
      "outbox-1",
      { warn: mockLoggerWarn },
      { record: (event) => metrics.push(event) }
    );

    expect(mockPersistDocument).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      epochProofs: [
        expect.objectContaining({
          readable: true,
          recoveryGeneration: 0,
          wrapId: "wrap-1",
        }),
      ],
      keyEpoch: 1,
      messageId: "message-1",
      outboxId: "outbox-1",
      references: [
        {
          kind: "media",
          mediaKind: "image",
          ordinal: 0,
          requiredId: "media_1",
        },
      ],
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
    expect(metrics).toEqual([
      expect.objectContaining({
        job: "live-index",
        outcome: "indexed",
        rows: 1,
      }),
    ]);
    expect(metrics[0]).not.toHaveProperty("conversationId");
    expect(metrics[0]).not.toHaveProperty("messageId");
  });

  test("telemetry sink failures do not fail an indexed message", async () => {
    const { processMessageSearchOutbox } =
      await import("./message-search-index");

    await expect(
      processMessageSearchOutbox(
        "outbox-1",
        { warn: mockLoggerWarn },
        {
          record: () => {
            throw new Error("telemetry unavailable");
          },
        }
      )
    ).resolves.toBeUndefined();
    expect(mockPersistDocument).toHaveBeenCalledTimes(1);
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
      references: [],
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
      references: [],
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
      unrecoverableEpoch: 1,
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
    const metrics: MessageSearchWorkerMetricEvent[] = [];
    const result = await processMessageSearchBackfill(
      "conversation-1",
      {
        warn: mockLoggerWarn,
      },
      { record: (event) => metrics.push(event) }
    );

    expect(mockCommitBackfill).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        messageOutcomes: [
          expect.objectContaining({
            messageId: "message-1",
            status: "indexed",
            unrecoverableEpoch: false,
          }),
        ],
        rowsTraversed: 1,
        throughSequence: 10,
      })
    );
    expect(result).toEqual({
      finished: false,
      nextCursorMessageId: "message-1",
    });
    expect(metrics).toEqual([
      expect.objectContaining({
        job: "backfill",
        outcome: "completed",
        rows: 1,
        unreadableRows: 0,
      }),
    ]);
  });

  test("deduplicates unavailable key epochs and retains unknown-epoch gaps", async () => {
    identity = {
      ...identity,
      masterKeyHash: null,
      updatedAt: new Date("2026-10-02T00:00:00.000Z"),
    };
    mockLoadIdentities.mockReturnValue(Promise.resolve([identity]));
    mockReadBackfill.mockReturnValue(
      Promise.resolve({
        ...backfillBatch,
        messages: [
          message,
          { ...message, id: "message-2" },
          { ...message, id: "message-legacy", keyEpoch: null },
        ],
      })
    );
    const { processMessageSearchBackfill } =
      await import("./message-search-index");

    await processMessageSearchBackfill("conversation-1", {
      warn: mockLoggerWarn,
    });

    expect(mockCommitBackfill).toHaveBeenCalledWith(
      expect.objectContaining({
        messageOutcomes: [
          expect.objectContaining({
            keyEpoch: 1,
            messageId: "message-1",
            status: "unreadable",
            unrecoverableEpoch: true,
          }),
          expect.objectContaining({
            keyEpoch: 1,
            messageId: "message-2",
            status: "unreadable",
            unrecoverableEpoch: true,
          }),
          expect.objectContaining({
            keyEpoch: null,
            messageId: "message-legacy",
            status: "unreadable",
            unrecoverableEpoch: false,
          }),
        ],
      })
    );
  });

  test("does not misclassify authenticated but corrupt payloads as unavailable epochs", async () => {
    mockDecryptMessage.mockRejectedValueOnce(new Error("invalid ciphertext"));
    const { processMessageSearchBackfill } =
      await import("./message-search-index");

    await processMessageSearchBackfill("conversation-1", {
      warn: mockLoggerWarn,
    });

    expect(mockCommitBackfill).toHaveBeenCalledWith(
      expect.objectContaining({
        messageOutcomes: [
          expect.objectContaining({
            keyEpoch: 1,
            messageId: "message-1",
            status: "unreadable",
            unrecoverableEpoch: false,
          }),
        ],
      })
    );
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
