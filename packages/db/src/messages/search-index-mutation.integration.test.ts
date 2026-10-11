import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  closeMessageSearchPool,
  commitMessageSearchBackfillBatch,
  listMessageConversationChanges,
  markSearchOutboxUnreadable,
  commitMessageSearchMutation,
  keys,
  prisma,
  startMessageSearchBackfill,
} from "@asm/db";

const RUN_ID = crypto.randomUUID();
const CONVERSATION_ID = crypto.randomUUID();
const UNREADABLE_CONVERSATION_ID = crypto.randomUUID();
const OWNER_ID = `search-mutation-owner-${RUN_ID}`;
const PEER_ID = `search-mutation-peer-${RUN_ID}`;
const UNREADABLE_OWNER_ID = `search-mutation-unreadable-owner-${RUN_ID}`;
const UNREADABLE_PEER_ID = `search-mutation-unreadable-peer-${RUN_ID}`;
const MESSAGE_ID = crypto.randomUUID();
const UNREADABLE_MESSAGE_IDS = [
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
];
const UNREADABLE_OUTBOX_IDS = [
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
];
const GAP_CONVERSATION_ID = crypto.randomUUID();
const GAP_OWNER_ID = `search-mutation-gap-owner-${RUN_ID}`;
const GAP_PEER_ID = `search-mutation-gap-peer-${RUN_ID}`;
const GAP_MESSAGE_IDS = [crypto.randomUUID(), crypto.randomUUID()];
const GAP_OUTBOX_IDS = [crypto.randomUUID(), crypto.randomUUID()];
const OUTBOX_IDS: string[] = [...UNREADABLE_OUTBOX_IDS, ...GAP_OUTBOX_IDS];

function assertLocalTestDatabase(): void {
  const databaseUrl = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== "5433" ||
    databaseUrl.pathname.replace(/^\//, "") !== "asocialmedia"
  ) {
    throw new Error(
      "Refusing to run DM search mutation integration tests outside the local test database"
    );
  }
}

beforeAll(async () => {
  assertLocalTestDatabase();
  await prisma.transaction(async (tx) => {
    await tx.orm.public.Users.createAll([
      {
        displayName: OWNER_ID,
        email: `${OWNER_ID}@example.test`,
        id: OWNER_ID,
        username: OWNER_ID,
      },
      {
        displayName: PEER_ID,
        email: `${PEER_ID}@example.test`,
        id: PEER_ID,
        username: PEER_ID,
      },
      {
        displayName: UNREADABLE_OWNER_ID,
        email: `${UNREADABLE_OWNER_ID}@example.test`,
        id: UNREADABLE_OWNER_ID,
        username: UNREADABLE_OWNER_ID,
      },
      {
        displayName: UNREADABLE_PEER_ID,
        email: `${UNREADABLE_PEER_ID}@example.test`,
        id: UNREADABLE_PEER_ID,
        username: UNREADABLE_PEER_ID,
      },
    ]);
    await tx.orm.public.MessageConversations.createAll([
      {
        id: CONVERSATION_ID,
        pairKey: [OWNER_ID, PEER_ID].toSorted().join(":"),
      },
      {
        changeSeq: 3,
        id: UNREADABLE_CONVERSATION_ID,
        pairKey: [UNREADABLE_OWNER_ID, UNREADABLE_PEER_ID].toSorted().join(":"),
      },
    ]);
    await tx.orm.public.MessageConversationMembers.createAll(
      [
        [CONVERSATION_ID, OWNER_ID],
        [CONVERSATION_ID, PEER_ID],
        [UNREADABLE_CONVERSATION_ID, UNREADABLE_OWNER_ID],
        [UNREADABLE_CONVERSATION_ID, UNREADABLE_PEER_ID],
      ].map(([conversationId, userId]) => ({ conversationId, userId }))
    );
    await tx.orm.public.Messages.createAll([
      {
        ciphertext: "test-ciphertext",
        conversationId: CONVERSATION_ID,
        id: MESSAGE_ID,
        iv: "test-iv",
        ratchetIndex: 0,
        senderId: OWNER_ID,
      },
      {
        ciphertext: "unreadable-ciphertext",
        conversationId: UNREADABLE_CONVERSATION_ID,
        creationSequence: 1,
        id: UNREADABLE_MESSAGE_IDS[0],
        iv: "unreadable-iv",
        keyEpoch: 1,
        ratchetIndex: 0,
        senderId: UNREADABLE_OWNER_ID,
      },
      {
        ciphertext: "unreadable-ciphertext-2",
        conversationId: UNREADABLE_CONVERSATION_ID,
        creationSequence: 2,
        id: UNREADABLE_MESSAGE_IDS[1],
        iv: "unreadable-iv-2",
        keyEpoch: 1,
        ratchetIndex: 1,
        senderId: UNREADABLE_OWNER_ID,
      },
      {
        ciphertext: "unreadable-ciphertext-3",
        conversationId: UNREADABLE_CONVERSATION_ID,
        creationSequence: 3,
        id: UNREADABLE_MESSAGE_IDS[2],
        iv: "unreadable-iv-3",
        ratchetIndex: 2,
        senderId: UNREADABLE_OWNER_ID,
      },
    ]);
    await tx.orm.public.MessageSearchOutbox.createAll(
      UNREADABLE_OUTBOX_IDS.map((id, index) => ({
        audienceUserIds: [UNREADABLE_OWNER_ID, UNREADABLE_PEER_ID],
        changeSequence: index + 1,
        conversationId: UNREADABLE_CONVERSATION_ID,
        id,
        kind: "upsert" as const,
        messageId: UNREADABLE_MESSAGE_IDS[index],
        revision: 1,
      }))
    );
  });
});

afterAll(async () => {
  if (OUTBOX_IDS.length > 0) {
    await prisma.orm.public.MessageSearchOutbox.where((outbox) =>
      outbox.id.in(OUTBOX_IDS)
    ).deleteAndCount();
  }
  await prisma.orm.public.MessageConversationChanges.where({
    conversationId: CONVERSATION_ID,
  }).deleteAndCount();
  await prisma.orm.public.MessageConversations.where((conversation) =>
    conversation.id.in([
      CONVERSATION_ID,
      UNREADABLE_CONVERSATION_ID,
      GAP_CONVERSATION_ID,
    ])
  ).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in([
      OWNER_ID,
      PEER_ID,
      UNREADABLE_OWNER_ID,
      UNREADABLE_PEER_ID,
      GAP_OWNER_ID,
      GAP_PEER_ID,
    ])
  ).deleteAndCount();
  await closeMessageSearchPool();
});

describe("commitMessageSearchMutation", () => {
  test("settles an unreadable outbox item under the coverage lock", async () => {
    await Promise.all(
      UNREADABLE_OUTBOX_IDS.map((outboxId, index) =>
        markSearchOutboxUnreadable({
          changeSequence: index + 1,
          conversationId: UNREADABLE_CONVERSATION_ID,
          outboxId,
          revision: 1,
          unrecoverableEpoch: index < 2 ? 1 : null,
        })
      )
    );
    await markSearchOutboxUnreadable({
      changeSequence: 1,
      conversationId: UNREADABLE_CONVERSATION_ID,
      outboxId: UNREADABLE_OUTBOX_IDS[0],
      revision: 1,
      unrecoverableEpoch: 1,
    });

    const [outbox, coverage] = await Promise.all([
      prisma.orm.public.MessageSearchOutbox.select("completedAt")
        .where({ id: UNREADABLE_OUTBOX_IDS[0] })
        .first(),
      prisma.orm.public.MessageSearchCoverage.select(
        "completedChangeSeq",
        "unrecoverableEpochs",
        "unrecoverableEpochIds",
        "hasUnreadableMessages"
      )
        .where({ conversationId: UNREADABLE_CONVERSATION_ID })
        .first(),
    ]);
    expect(outbox?.completedAt).toBeTruthy();
    expect(coverage).toEqual({
      completedChangeSeq: 3,
      hasUnreadableMessages: true,
      unrecoverableEpochIds: [1],
      unrecoverableEpochs: 1,
    });
  });

  test("commits the revision, sequence, and outbox event as one mutation", async () => {
    const editRequests = await Promise.all(
      ["rewrite-a", "rewrite-b"].map((ciphertext) =>
        commitMessageSearchMutation({
          ciphertext,
          conversationId: CONVERSATION_ID,
          editWindowStart: new Date(Date.now() - 12 * 60 * 60 * 1000),
          editedAt: new Date(),
          expectedRevision: 1,
          iv: `${ciphertext}-iv`,
          kind: "upsert",
          messageId: MESSAGE_ID,
          senderId: OWNER_ID,
        })
      )
    );
    const edited = editRequests.find((result) => result.status === "updated");
    if (!edited || edited.status !== "updated") {
      throw new Error("expected one concurrent edit to commit");
    }
    expect(edited.status).toBe("updated");
    expect(
      editRequests.filter((result) => result.status === "revision-conflict")
    ).toHaveLength(1);
    OUTBOX_IDS.push(edited.outboxId);
    expect(edited.revision).toBe(2);
    expect(edited.changeSequence).toBe(1);

    const deleted = await commitMessageSearchMutation({
      conversationId: CONVERSATION_ID,
      deletedAt: new Date(),
      expectedRevision: 2,
      kind: "delete",
      messageId: MESSAGE_ID,
      senderId: OWNER_ID,
    });
    expect(deleted.status).toBe("updated");
    if (deleted.status !== "updated") {
      throw new Error("expected delete to commit");
    }
    OUTBOX_IDS.push(deleted.outboxId);
    expect(deleted.revision).toBe(3);
    expect(deleted.changeSequence).toBe(2);

    const duplicateDelete = await commitMessageSearchMutation({
      conversationId: CONVERSATION_ID,
      deletedAt: new Date(),
      expectedRevision: 3,
      kind: "delete",
      messageId: MESSAGE_ID,
      senderId: OWNER_ID,
    });
    expect(duplicateDelete).toEqual({ status: "already-deleted" });

    const storedMessage = await prisma.orm.public.Messages.select(
      "ciphertext",
      "deletedAt",
      "revision"
    )
      .where({ id: MESSAGE_ID })
      .first();
    const storedConversation =
      await prisma.orm.public.MessageConversations.select("changeSeq")
        .where({ id: CONVERSATION_ID })
        .first();
    const outbox = await prisma.orm.public.MessageSearchOutbox.select(
      "changeSequence",
      "kind",
      "revision"
    )
      .where({ conversationId: CONVERSATION_ID })
      .all();
    const changes = await prisma.orm.public.MessageConversationChanges.select(
      "audienceUserIds",
      "kind",
      "messageId",
      "revision",
      "sequence"
    )
      .where({ conversationId: CONVERSATION_ID })
      .orderBy((change) => change.sequence.asc())
      .all();

    expect(storedMessage?.ciphertext).toMatch(/^rewrite-[ab]$/);
    expect(storedMessage?.deletedAt).not.toBeNull();
    expect(storedMessage?.revision).toBe(3);
    expect(storedConversation?.changeSeq).toBe(2);
    expect(outbox).toHaveLength(2);
    expect(
      outbox.map((row) => [row.kind, row.revision, row.changeSequence])
    ).toEqual([
      ["upsert", 2, 1],
      ["delete", 3, 2],
    ]);
    expect(
      changes.map((change) => [
        change.kind,
        change.messageId,
        change.revision,
        change.sequence,
      ])
    ).toEqual([
      ["message.edited", MESSAGE_ID, 2, 1],
      ["message.deleted", MESSAGE_ID, 3, 2],
    ]);
    expect(changes.every((change) => change.audienceUserIds.length === 2)).toBe(
      true
    );
    const replay = await listMessageConversationChanges({
      afterSequence: 0,
      conversationId: CONVERSATION_ID,
      limit: 10,
      membershipWindows: [{ after: null, before: null }],
      snapshotSequence: 2,
      userId: OWNER_ID,
    });
    expect(replay.map((change) => change.sourceRevision)).toEqual([3, 3]);
    expect(replay.map((change) => change.globallyDeleted)).toEqual([
      true,
      true,
    ]);
    expect(replay.every((change) => change.hiddenForViewer === false)).toBe(
      true
    );
  });
});

describe("refreshUnreadableSearchCoverage", () => {
  test("excludes stale-revision and deleted gaps and clears on retry", async () => {
    await prisma.transaction(async (tx) => {
      await tx.orm.public.Users.createAll([
        {
          displayName: GAP_OWNER_ID,
          email: `${GAP_OWNER_ID}@example.test`,
          id: GAP_OWNER_ID,
          username: GAP_OWNER_ID,
        },
        {
          displayName: GAP_PEER_ID,
          email: `${GAP_PEER_ID}@example.test`,
          id: GAP_PEER_ID,
          username: GAP_PEER_ID,
        },
      ]);
      await tx.orm.public.MessageConversations.create({
        id: GAP_CONVERSATION_ID,
        pairKey: [GAP_OWNER_ID, GAP_PEER_ID].toSorted().join(":"),
      });
      await tx.orm.public.MessageConversationMembers.createAll([
        { conversationId: GAP_CONVERSATION_ID, userId: GAP_OWNER_ID },
        { conversationId: GAP_CONVERSATION_ID, userId: GAP_PEER_ID },
      ]);
      await tx.orm.public.Messages.createAll([
        {
          ciphertext: "gap-ciphertext-1",
          conversationId: GAP_CONVERSATION_ID,
          creationSequence: 1,
          id: GAP_MESSAGE_IDS[0],
          iv: "gap-iv-1",
          keyEpoch: 7,
          ratchetIndex: 0,
          senderId: GAP_OWNER_ID,
        },
        {
          ciphertext: "gap-ciphertext-2",
          conversationId: GAP_CONVERSATION_ID,
          creationSequence: 2,
          id: GAP_MESSAGE_IDS[1],
          iv: "gap-iv-2",
          ratchetIndex: 1,
          senderId: GAP_OWNER_ID,
        },
      ]);
      await tx.orm.public.MessageSearchOutbox.createAll(
        GAP_OUTBOX_IDS.map((id, index) => ({
          audienceUserIds: [GAP_OWNER_ID, GAP_PEER_ID],
          changeSequence: index + 1,
          conversationId: GAP_CONVERSATION_ID,
          id,
          kind: "upsert" as const,
          messageId: GAP_MESSAGE_IDS[index],
          revision: 1,
        }))
      );
    });

    // One gap with a known unrecoverable epoch and one with an unknown
    // epoch keeps scope honest without inventing an epoch number.
    await markSearchOutboxUnreadable({
      changeSequence: 1,
      conversationId: GAP_CONVERSATION_ID,
      outboxId: GAP_OUTBOX_IDS[0],
      revision: 1,
      unrecoverableEpoch: 7,
    });
    await markSearchOutboxUnreadable({
      changeSequence: 2,
      conversationId: GAP_CONVERSATION_ID,
      outboxId: GAP_OUTBOX_IDS[1],
      revision: 1,
      unrecoverableEpoch: null,
    });
    const beforeRepair = await prisma.orm.public.MessageSearchCoverage.select(
      "unrecoverableEpochs",
      "unrecoverableEpochIds",
      "hasUnreadableMessages"
    )
      .where({ conversationId: GAP_CONVERSATION_ID })
      .first();
    expect(beforeRepair).toEqual({
      hasUnreadableMessages: true,
      unrecoverableEpochIds: [7],
      unrecoverableEpochs: 1,
    });

    // A new revision makes the first gap stale and deleting the second
    // message removes its gap from readable coverage entirely.
    const edited = await commitMessageSearchMutation({
      ciphertext: "gap-rewrite",
      conversationId: GAP_CONVERSATION_ID,
      editWindowStart: new Date(Date.now() - 12 * 60 * 60 * 1000),
      editedAt: new Date(),
      expectedRevision: 1,
      iv: "gap-rewrite-iv",
      kind: "upsert",
      messageId: GAP_MESSAGE_IDS[0],
      senderId: GAP_OWNER_ID,
    });
    if (edited.status !== "updated") {
      throw new Error("expected gap message edit to commit");
    }
    OUTBOX_IDS.push(edited.outboxId);
    const deleted = await commitMessageSearchMutation({
      conversationId: GAP_CONVERSATION_ID,
      deletedAt: new Date(),
      expectedRevision: 1,
      kind: "delete",
      messageId: GAP_MESSAGE_IDS[1],
      senderId: GAP_OWNER_ID,
    });
    if (deleted.status !== "updated") {
      throw new Error("expected gap message delete to commit");
    }
    OUTBOX_IDS.push(deleted.outboxId);

    // A successful backfill retry for the edited revision resolves the
    // stale gap and the delete resolves the second gap.
    const started = await startMessageSearchBackfill(GAP_CONVERSATION_ID);
    if (!started || started.throughSequence === null) {
      throw new Error("expected gap backfill to start");
    }
    const committed = await commitMessageSearchBackfillBatch({
      artifacts: [
        {
          createdAt: new Date(),
          keyEpoch: 7,
          messageId: GAP_MESSAGE_IDS[0],
          references: [],
          revision: 2,
          terms: [{ gramKeys: ["gap"], normalized: "gaptest" }],
        },
      ],
      conversationId: GAP_CONVERSATION_ID,
      expectedPosition: started.expectedPosition,
      finished: true,
      messageOutcomes: [
        {
          keyEpoch: 7,
          messageId: GAP_MESSAGE_IDS[0],
          revision: 2,
          status: "indexed",
          unrecoverableEpoch: false,
        },
        {
          keyEpoch: null,
          messageId: GAP_MESSAGE_IDS[1],
          revision: 2,
          status: "deleted",
          unrecoverableEpoch: false,
        },
      ],
      nextPosition: started.expectedPosition,
      rowsTraversed: 2,
      throughSequence: started.throughSequence,
    });
    expect(committed).toEqual({ committed: true });

    const [afterRepair, remainingGaps] = await Promise.all([
      prisma.orm.public.MessageSearchCoverage.select(
        "unrecoverableEpochs",
        "unrecoverableEpochIds",
        "hasUnreadableMessages"
      )
        .where({ conversationId: GAP_CONVERSATION_ID })
        .first(),
      prisma.orm.public.MessageSearchGap.select("messageId")
        .where({
          conversationId: GAP_CONVERSATION_ID,
        })
        .all(),
    ]);
    expect(afterRepair).toEqual({
      hasUnreadableMessages: false,
      unrecoverableEpochIds: [],
      unrecoverableEpochs: 0,
    });
    expect(remainingGaps).toHaveLength(0);
  });
});
