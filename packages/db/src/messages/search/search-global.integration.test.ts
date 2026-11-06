import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  closeMessageSearchPool,
  keys,
  listGlobalMessageSearchScope,
  prisma,
  searchGlobalMessageCandidates,
  toPrismaDateTime,
} from "@asm/db";
import {
  messageSearchGramKeys,
  messageSearchQueryGramKeys,
  messageSearchTerms,
  normalizeMessageSearchQuery,
} from "@asm/messages/search";

import { seedVerifiedMessageEpochFixture } from "../testing/epoch-readability-fixture";

const RUN_ID = crypto.randomUUID();
const OWNER_ID = `global-search-owner-${RUN_ID}`;
const DM_A_PEER_ID = `global-search-peer-a-${RUN_ID}`;
const DM_B_PEER_ID = `global-search-peer-b-${RUN_ID}`;
const DEN_PEER_ID = `global-search-peer-den-${RUN_ID}`;
const DM_A_ID = crypto.randomUUID();
const DM_B_ID = crypto.randomUUID();
const DEN_ID = crypto.randomUUID();
const DM_A_BOTH_ID = crypto.randomUUID();
const DM_A_ONE_ID = crypto.randomUUID();
const DM_A_HIDDEN_ID = crypto.randomUUID();
const DM_B_BOTH_ID = crypto.randomUUID();
const DM_B_ONE_ID = crypto.randomUUID();
const DEN_BOTH_ID = crypto.randomUUID();
const CONVERSATION_IDS = [DM_A_ID, DM_B_ID, DEN_ID];
const timestamp = new Date("2026-10-10T10:00:00.000Z");
const SENDER_BY_CONVERSATION = new Map([
  [DM_A_ID, DM_A_PEER_ID],
  [DM_B_ID, DM_B_PEER_ID],
  [DEN_ID, DEN_PEER_ID],
]);

const fixtures = [
  { conversationId: DM_A_ID, id: DM_A_BOTH_ID, text: "alpha beta" },
  { conversationId: DM_A_ID, id: DM_A_ONE_ID, text: "alpha only" },
  { conversationId: DM_A_ID, id: DM_A_HIDDEN_ID, text: "alpha beta hidden" },
  { conversationId: DM_B_ID, id: DM_B_BOTH_ID, text: "beta only" },
  { conversationId: DM_B_ID, id: DM_B_ONE_ID, text: "beta phrase" },
  { conversationId: DEN_ID, id: DEN_BOTH_ID, text: "alpha beta in den" },
] as const;

function assertLocalTestDatabase(): void {
  const databaseUrl = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== "5433" ||
    databaseUrl.pathname.replace(/^\//u, "") !== "asocialmedia"
  ) {
    throw new Error(
      "Refusing to run global message search integration tests outside the local test database"
    );
  }
}

async function seedConversationSearchRows(): Promise<void> {
  await prisma.transaction(async (tx) => {
    await tx.orm.public.Messages.createAll(
      fixtures.map((fixture, index) => ({
        ciphertext: `ciphertext-${fixture.id}`,
        conversationId: fixture.conversationId,
        createdAt: toPrismaDateTime(
          new Date(timestamp.getTime() + index * 1000)
        ),
        creationSequence: index + 1,
        id: fixture.id,
        iv: `iv-${fixture.id}`,
        keyEpoch: 1,
        ratchetIndex: index + 1,
        revision: 1,
        senderId:
          SENDER_BY_CONVERSATION.get(fixture.conversationId) ?? DEN_PEER_ID,
      }))
    );

    await Promise.all(
      CONVERSATION_IDS.map(async (conversationId) => {
        const conversationFixtures = fixtures.filter(
          (fixture) => fixture.conversationId === conversationId
        );
        const terms = [
          ...new Set(
            conversationFixtures.flatMap((fixture) =>
              messageSearchTerms(fixture.text)
            )
          ),
        ];
        await tx.orm.public.MessageSearchTerms.createAll(
          terms.map((normalized) => ({
            conversationId,
            gramKeys: messageSearchGramKeys(normalized),
            normalized,
          }))
        );
        const termRows = await tx.orm.public.MessageSearchTerms.select(
          "id",
          "normalized"
        )
          .where({ conversationId })
          .all();
        const termIds = new Map(
          termRows.map((term) => [term.normalized, term.id])
        );
        await tx.orm.public.MessageSearchDocuments.createAll(
          conversationFixtures.map((fixture) => ({
            conversationId,
            createdAt: toPrismaDateTime(
              new Date(timestamp.getTime() + fixtures.indexOf(fixture) * 1000)
            ),
            messageId: fixture.id,
            revision: 1,
            termIds: messageSearchTerms(fixture.text).flatMap((term) => {
              const id = termIds.get(term);
              return id === undefined ? [] : [id];
            }),
          }))
        );
      })
    );
  });
}

beforeAll(async () => {
  assertLocalTestDatabase();
  const users = [OWNER_ID, DM_A_PEER_ID, DM_B_PEER_ID, DEN_PEER_ID];
  await prisma.transaction(async (tx) => {
    await tx.orm.public.Users.createAll(
      users.map((id) => ({
        displayName: id,
        email: `${id}@example.test`,
        id,
        username: id,
      }))
    );
    await tx.orm.public.MessageConversations.createAll([
      {
        changeSeq: 10,
        id: DM_A_ID,
        pairKey: [OWNER_ID, DM_A_PEER_ID].toSorted().join(":"),
      },
      {
        changeSeq: 10,
        id: DM_B_ID,
        pairKey: [OWNER_ID, DM_B_PEER_ID].toSorted().join(":"),
      },
      { _type: "DEN", changeSeq: 10, id: DEN_ID, name: "Search den" },
    ]);
    await tx.orm.public.MessageConversationMembers.createAll(
      [
        [DM_A_ID, OWNER_ID],
        [DM_A_ID, DM_A_PEER_ID],
        [DM_B_ID, OWNER_ID],
        [DM_B_ID, DM_B_PEER_ID],
        [DEN_ID, OWNER_ID],
        [DEN_ID, DEN_PEER_ID],
      ].map(([conversationId, userId]) => ({ conversationId, userId }))
    );
    await tx.orm.public.MessageConversationKeys.createAll(
      CONVERSATION_IDS.map((conversationId) => ({
        conversationId,
        encryptedKey: `owner-wrap-${conversationId}`,
        iv: `wrap-iv-${conversationId}`,
        ownerUserId: OWNER_ID,
        ...(conversationId === DEN_ID
          ? {
              wrapperPublicKey: `fixture-public:${DEN_PEER_ID}`,
              wrapperUserId: DEN_PEER_ID,
            }
          : {}),
        version: 1,
      }))
    );
  });

  await seedConversationSearchRows();
  await Promise.all(CONVERSATION_IDS.map(seedVerifiedMessageEpochFixture));
  await prisma.orm.public.MessageHiddens.create({
    messageId: DM_A_HIDDEN_ID,
    userId: OWNER_ID,
  });
}, 30_000);

afterAll(async () => {
  await prisma.orm.public.MessageHiddens.where({
    userId: OWNER_ID,
  }).deleteAndCount();
  await prisma.orm.public.MessageSearchDocuments.where((document) =>
    document.conversationId.in(CONVERSATION_IDS)
  ).deleteAndCount();
  await prisma.orm.public.MessageSearchTerms.where((term) =>
    term.conversationId.in(CONVERSATION_IDS)
  ).deleteAndCount();
  await prisma.orm.public.MessageConversations.where((conversation) =>
    conversation.id.in(CONVERSATION_IDS)
  ).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in([OWNER_ID, DM_A_PEER_ID, DM_B_PEER_ID, DEN_PEER_ID])
  ).deleteAndCount();
  await closeMessageSearchPool();
});

describe("global message search readers", () => {
  async function fixtureInput(): Promise<
    Parameters<typeof searchGlobalMessageCandidates>[0]
  > {
    const rows = await listGlobalMessageSearchScope({
      conversationType: "ALL",
      userId: OWNER_ID,
    });
    return {
      fragments: normalizeMessageSearchQuery("alpha beta").tokens.map(
        (text) => ({ grams: messageSearchQueryGramKeys(text), text })
      ),
      limit: 1,
      scope: rows.map((row) => ({
        conversationId: row.conversationId,
        membershipSequence: row.membershipSequence,
        snapshotSequence: row.snapshotSequence,
        windows: [{ after: null, before: null }],
      })),
      userId: OWNER_ID,
    };
  }

  test("merges conversation pages in global order and continues without duplicates", async () => {
    const input = await fixtureInput();
    const first = await searchGlobalMessageCandidates(input);
    expect(first.map((hit) => hit.id)).toEqual([DEN_BOTH_ID]);
    const [cursor] = first;
    if (!cursor) {
      throw new Error("Expected a first search result");
    }
    const second = await searchGlobalMessageCandidates({
      ...input,
      after: {
        conversationId: cursor.conversationId,
        createdAt: cursor.createdAt,
        messageId: cursor.id,
      },
    });
    expect(second.map((hit) => hit.id)).toEqual([DM_A_BOTH_ID]);
  });

  test("applies hidden-message and membership-window checks before the per-conversation limit", async () => {
    const input = await fixtureInput();
    const dmOnly = input.scope.filter(
      (entry) => entry.conversationId === DM_A_ID
    );
    const dmHits = await searchGlobalMessageCandidates({
      ...input,
      scope: dmOnly,
    });
    expect(dmHits.map((hit) => hit.id)).toEqual([DM_A_BOTH_ID]);
    const scoped = input.scope.map((entry) => ({
      ...entry,
      windows: [
        {
          after: null,
          before: new Date(timestamp.getTime() + 500).toISOString(),
        },
      ],
    }));
    const scopedHits = await searchGlobalMessageCandidates({
      ...input,
      scope: scoped,
    });
    expect(scopedHits.map((hit) => hit.id)).toEqual([DM_A_BOTH_ID]);
  });

  test("uses the message identifier to continue when conversations share a timestamp", async () => {
    const input = await fixtureInput();
    const tiedTimestamp = toPrismaDateTime(timestamp);
    await prisma.orm.public.Messages.where({ id: DEN_BOTH_ID }).update({
      createdAt: tiedTimestamp,
    });
    await prisma.orm.public.MessageSearchDocuments.where({
      messageId: DEN_BOTH_ID,
    }).update({ createdAt: tiedTimestamp });
    try {
      const expected = [DEN_BOTH_ID, DM_A_BOTH_ID].toSorted().toReversed();
      const [first] = await searchGlobalMessageCandidates(input);
      expect(first?.id).toBe(expected[0]);
      if (!first) {
        throw new Error("Expected a tied result");
      }
      const [second] = await searchGlobalMessageCandidates({
        ...input,
        after: {
          conversationId: first.conversationId,
          createdAt: first.createdAt,
          messageId: first.id,
        },
      });
      expect(second?.id).toBe(expected[1]);
    } finally {
      const restored = toPrismaDateTime(new Date(timestamp.getTime() + 5000));
      await prisma.orm.public.Messages.where({ id: DEN_BOTH_ID }).update({
        createdAt: restored,
      });
      await prisma.orm.public.MessageSearchDocuments.where({
        messageId: DEN_BOTH_ID,
      }).update({ createdAt: restored });
    }
  });

  test("rejects forged viewers and stale membership snapshots", async () => {
    const input = await fixtureInput();
    expect(
      await searchGlobalMessageCandidates({ ...input, userId: "non-member" })
    ).toHaveLength(0);
    expect(
      await searchGlobalMessageCandidates({
        ...input,
        scope: input.scope.map((entry) => ({
          ...entry,
          membershipSequence: entry.membershipSequence + 1,
        })),
      })
    ).toHaveLength(0);
  });

  test("excludes expired and revised source rows while leaving other conversations searchable", async () => {
    const input = await fixtureInput();
    await prisma.orm.public.Messages.where({ id: DEN_BOTH_ID }).update({
      expiresAt: toPrismaDateTime(new Date(Date.now() - 1000)),
    });
    try {
      const hits = await searchGlobalMessageCandidates(input);
      expect(hits.map((hit) => hit.id)).toEqual([DM_A_BOTH_ID]);
    } finally {
      await prisma.orm.public.Messages.where({ id: DEN_BOTH_ID }).update({
        expiresAt: null,
      });
    }
    await prisma.orm.public.Messages.where({ id: DEN_BOTH_ID }).update({
      revision: 2,
    });
    try {
      const hits = await searchGlobalMessageCandidates(input);
      expect(hits.map((hit) => hit.id)).toEqual([DM_A_BOTH_ID]);
    } finally {
      await prisma.orm.public.Messages.where({ id: DEN_BOTH_ID }).update({
        revision: 1,
      });
    }
  });

  test("excludes mutations newer than the search snapshot", async () => {
    const input = await fixtureInput();
    const outbox = await prisma.orm.public.MessageSearchOutbox.create({
      changeSequence: 11,
      conversationId: DEN_ID,
      kind: "upsert",
      messageId: DEN_BOTH_ID,
      revision: 2,
    });
    await prisma.orm.public.MessageConversations.where({ id: DEN_ID }).update({
      changeSeq: 11,
    });
    try {
      const hits = await searchGlobalMessageCandidates(input);
      expect(hits.map((hit) => hit.id)).toEqual([DM_A_BOTH_ID]);
    } finally {
      await prisma.orm.public.MessageSearchOutbox.where({
        id: outbox.id,
      }).deleteAndCount();
      await prisma.orm.public.MessageConversations.where({ id: DEN_ID }).update(
        { changeSeq: 10 }
      );
    }
  });

  test("rechecks a block or whole-chat clear after a search scope was created", async () => {
    const base = await fixtureInput();
    const input = {
      ...base,
      scope: base.scope.filter((entry) => entry.conversationId === DM_A_ID),
    };
    await prisma.orm.public.Blocks.create({
      blockedId: DM_A_PEER_ID,
      blockerId: OWNER_ID,
    });
    try {
      expect(await searchGlobalMessageCandidates(input)).toHaveLength(0);
    } finally {
      await prisma.orm.public.Blocks.where({
        blockedId: DM_A_PEER_ID,
        blockerId: OWNER_ID,
      }).deleteAndCount();
    }
    await prisma.orm.public.MessageConversationMembers.where({
      conversationId: DM_A_ID,
      userId: OWNER_ID,
    }).update({ clearedThroughSequence: 10 });
    try {
      expect(await searchGlobalMessageCandidates(input)).toHaveLength(0);
    } finally {
      await prisma.orm.public.MessageConversationMembers.where({
        conversationId: DM_A_ID,
        userId: OWNER_ID,
      }).update({ clearedThroughSequence: 0 });
    }
  });

  test("requires a current viewer-owned readable key proof", async () => {
    const base = await fixtureInput();
    const input = {
      ...base,
      scope: base.scope.filter((entry) => entry.conversationId === DM_A_ID),
    };
    await prisma.orm.public.MessageConversationKeys.where({
      conversationId: DM_A_ID,
      ownerUserId: OWNER_ID,
      version: 1,
    }).update({ encryptedKey: "changed-owner-wrap" });
    try {
      expect(await searchGlobalMessageCandidates(input)).toHaveLength(0);
    } finally {
      await prisma.orm.public.MessageConversationKeys.where({
        conversationId: DM_A_ID,
        ownerUserId: OWNER_ID,
        version: 1,
      }).update({ encryptedKey: `owner-wrap-${DM_A_ID}` });
    }
  });

  test("scopes DM and den access independently and excludes blocked DMs", async () => {
    await prisma.orm.public.Blocks.create({
      blockedId: DM_B_PEER_ID,
      blockerId: OWNER_ID,
    });
    const all = await listGlobalMessageSearchScope({
      conversationType: "ALL",
      userId: OWNER_ID,
    });
    const dms = await listGlobalMessageSearchScope({
      conversationType: "DM",
      userId: OWNER_ID,
    });
    const dens = await listGlobalMessageSearchScope({
      conversationType: "DEN",
      userId: OWNER_ID,
    });
    await prisma.orm.public.Blocks.where({
      blockedId: DM_B_PEER_ID,
      blockerId: OWNER_ID,
    }).deleteAndCount();

    expect(all.map((row) => row.conversationId).toSorted()).toEqual(
      [DM_A_ID, DEN_ID].toSorted()
    );
    expect(dms.map((row) => row.conversationId)).toEqual([DM_A_ID]);
    expect(dens.map((row) => row.conversationId)).toEqual([DEN_ID]);
  });

  test("requires every query fragment to match in one conversation and filters hidden rows", async () => {
    const rows = await listGlobalMessageSearchScope({
      conversationType: "ALL",
      userId: OWNER_ID,
    });
    const normalized = normalizeMessageSearchQuery("alpha beta");
    const hits = await searchGlobalMessageCandidates({
      fragments: normalized.tokens.map((text) => ({
        grams: messageSearchQueryGramKeys(text),
        text,
      })),
      limit: 20,
      scope: rows.map((row) => ({
        conversationId: row.conversationId,
        membershipSequence: row.membershipSequence,
        snapshotSequence: row.snapshotSequence,
        windows: [{ after: null, before: null }],
      })),
      userId: OWNER_ID,
    });

    expect(hits.map((hit) => hit.id).toSorted()).toEqual(
      [DM_A_BOTH_ID, DEN_BOTH_ID].toSorted()
    );
    expect(hits.map((hit) => hit.conversationId).toSorted()).toEqual(
      [DM_A_ID, DEN_ID].toSorted()
    );
    expect(hits.map((hit) => hit.id)).not.toContain(DM_A_HIDDEN_ID);
    expect(hits.map((hit) => hit.id)).not.toContain(DM_B_BOTH_ID);
    expect(hits.every((hit) => hit.rootKeyCiphertext !== null)).toBe(true);
  });
});
