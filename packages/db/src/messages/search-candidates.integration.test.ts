import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  closeMessageSearchPool,
  keys,
  prisma,
  searchMessageCandidates,
  toPrismaDateTime,
} from "@asm/db";

import { seedVerifiedMessageEpochFixture } from "./epoch-readability-fixture";

const RUN_ID = crypto.randomUUID();
const CONVERSATION_ID = crypto.randomUUID();
const OWNER_ID = `search-candidate-owner-${RUN_ID}`;
const PEER_ID = `search-candidate-peer-${RUN_ID}`;
const OUTSIDER_ID = `search-candidate-outsider-${RUN_ID}`;
const SHORT_ID = crypto.randomUUID();
const URL_ID = crypto.randomUUID();
const ACCENT_ID = crypto.randomUUID();
const SCRIPT_ID = crypto.randomUUID();
const EMOJI_ID = crypto.randomUUID();
const LONG_TOKEN_ID = crypto.randomUUID();
const BOTH_TERMS_ID = crypto.randomUUID();
const ONE_TERM_ID = crypto.randomUUID();
const NEEDLE_VISIBLE_ID = crypto.randomUUID();
const NEEDLE_HIDDEN_ID = crypto.randomUUID();
const NEEDLE_DELETED_ID = crypto.randomUUID();
const NEEDLE_UNREADABLE_ID = crypto.randomUUID();
const NEEDLE_NEWER_THAN_SNAPSHOT_ID = crypto.randomUUID();
const NEEDLE_STALE_DOCUMENT_ID = crypto.randomUUID();
const WINDOW_VISIBLE_ID = crypto.randomUUID();
const WINDOW_HIDDEN_ID = crypto.randomUUID();
const GATE_HIDDEN_ID = crypto.randomUUID();
const GATE_FIRST_ID = `search-gate-a-${RUN_ID}`;
const GATE_SECOND_ID = `search-gate-b-${RUN_ID}`;
const REVERSE_VISIBLE_IDS = Array.from(
  { length: 24 },
  (_, index) => `reverse-visible-${String(index).padStart(3, "0")}-${RUN_ID}`
);
const OPEN_WINDOW = [{ after: null, before: null }] as const;

interface IndexedMessageFixture {
  createdAt: Date;
  creationSequence: number;
  deletedAt?: Date;
  documentRevision?: number;
  id: string;
  keyEpoch?: number;
  text: string;
  hidden?: boolean;
  revision?: number;
}

const baseTime = new Date("2026-10-08T00:00:00.000Z");
const windowEnd = new Date(baseTime.getTime() + 60_000);
const longToken = `${"x".repeat(508)}boundarytail`;

function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replaceAll(/\p{M}/gu, "").toLowerCase();
}

function gramKeys(value: string): string[] {
  const points = [...normalizeSearchText(value)];
  const gramSet = new Set<string>();
  for (let width = 1; width <= 3; width += 1) {
    for (let index = 0; index + width <= points.length; index += 1) {
      gramSet.add(`${width}:${points.slice(index, index + width).join("")}`);
    }
  }
  return [...gramSet];
}

function termsForText(value: string): string[] {
  const step = 512 - 255;
  const terms = new Set<string>();
  for (const token of normalizeSearchText(value).split(/\s+/u)) {
    const points = [...token];
    if (points.length <= 512) {
      if (token) {
        terms.add(token);
      }
      continue;
    }
    for (let start = 0; start < points.length; start += step) {
      terms.add(points.slice(start, start + 512).join(""));
    }
  }
  return [...terms];
}

const fixtures: IndexedMessageFixture[] = [
  {
    createdAt: new Date(baseTime.getTime() + 1000),
    creationSequence: 1,
    id: SHORT_ID,
    text: "this fragment is inside a word",
  },
  {
    createdAt: new Date(baseTime.getTime() + 2000),
    creationSequence: 2,
    id: URL_ID,
    text: "https://example.com/path?q=foo&lang=en",
  },
  {
    createdAt: new Date(baseTime.getTime() + 3000),
    creationSequence: 3,
    id: ACCENT_ID,
    text: "résumé café",
  },
  {
    createdAt: new Date(baseTime.getTime() + 4000),
    creationSequence: 4,
    id: SCRIPT_ID,
    text: "東京の猫がいる",
  },
  {
    createdAt: new Date(baseTime.getTime() + 5000),
    creationSequence: 5,
    id: EMOJI_ID,
    text: "wow🙂🚀here",
  },
  {
    createdAt: new Date(baseTime.getTime() + 6000),
    creationSequence: 6,
    id: LONG_TOKEN_ID,
    text: longToken,
  },
  {
    createdAt: new Date(baseTime.getTime() + 7000),
    creationSequence: 7,
    id: BOTH_TERMS_ID,
    text: "alpha beta",
  },
  {
    createdAt: new Date(baseTime.getTime() + 8000),
    creationSequence: 8,
    id: ONE_TERM_ID,
    text: "alpha only",
  },
  {
    createdAt: new Date(baseTime.getTime() + 9000),
    creationSequence: 9,
    id: NEEDLE_VISIBLE_ID,
    text: "needle",
  },
  {
    createdAt: new Date(baseTime.getTime() + 10_000),
    creationSequence: 10,
    hidden: true,
    id: NEEDLE_HIDDEN_ID,
    text: "needle",
  },
  {
    createdAt: new Date(baseTime.getTime() + 11_000),
    creationSequence: 11,
    deletedAt: new Date(baseTime.getTime() + 20_000),
    id: NEEDLE_DELETED_ID,
    text: "needle",
  },
  {
    createdAt: new Date(baseTime.getTime() + 12_000),
    creationSequence: 12,
    id: NEEDLE_UNREADABLE_ID,
    keyEpoch: 2,
    text: "needle",
  },
  {
    createdAt: new Date(baseTime.getTime() + 13_000),
    creationSequence: 21,
    id: NEEDLE_NEWER_THAN_SNAPSHOT_ID,
    text: "needle",
  },
  {
    createdAt: new Date(baseTime.getTime() + 14_000),
    creationSequence: 13,
    documentRevision: 1,
    id: NEEDLE_STALE_DOCUMENT_ID,
    revision: 2,
    text: "needle",
  },
  {
    createdAt: new Date(baseTime.getTime() + 15_000),
    creationSequence: 14,
    id: WINDOW_VISIBLE_ID,
    text: "windowed",
  },
  {
    createdAt: new Date(windowEnd.getTime() + 1),
    creationSequence: 15,
    id: WINDOW_HIDDEN_ID,
    text: "windowed",
  },
  {
    createdAt: new Date(baseTime.getTime() + 17_000),
    creationSequence: 16,
    hidden: true,
    id: GATE_HIDDEN_ID,
    text: "gate",
  },
  {
    createdAt: new Date(baseTime.getTime() + 16_000),
    creationSequence: 17,
    id: GATE_FIRST_ID,
    text: "gate",
  },
  {
    createdAt: new Date(baseTime.getTime() + 16_000),
    creationSequence: 18,
    id: GATE_SECOND_ID,
    text: "gate",
  },
  ...Array.from({ length: 220 }, (_, index) => ({
    createdAt: new Date(baseTime.getTime() + 120_000 + index * 1000),
    creationSequence: 19,
    hidden: true,
    id: `reverse-hidden-${index}-${RUN_ID}`,
    text: "reversepage",
  })),
  ...REVERSE_VISIBLE_IDS.map((id) => ({
    createdAt: new Date(baseTime.getTime() + 400_000),
    creationSequence: 19,
    id,
    text: "reversepage",
  })),
  {
    createdAt: new Date(baseTime.getTime() + 399_000),
    creationSequence: 21,
    id: `reverse-late-${RUN_ID}`,
    text: "reversepage",
  },
];

function assertLocalTestDatabase(): void {
  const databaseUrl = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== "5433" ||
    databaseUrl.pathname.replace(/^\//, "") !== "asocialmedia"
  ) {
    throw new Error(
      "Refusing to run DM search candidate tests outside the local test database"
    );
  }
}

function searchFragments(query: string): { grams: string[]; text: string }[] {
  return normalizeSearchText(query.trim())
    .split(/\s+/u)
    .filter(Boolean)
    .map((text) => ({
      grams: gramKeys(text),
      text,
    }));
}

async function search(
  query: string,
  options: {
    after?: { createdAt: Date; messageId: string };
    before?: { createdAt: Date; messageId: string };
    limit?: number;
    membershipWindows?: readonly { after: Date | null; before: Date | null }[];
    snapshotSequence?: number;
  } = {}
) {
  return await searchMessageCandidates({
    after: options.after,
    before: options.before,
    conversationId: CONVERSATION_ID,
    fragments: searchFragments(query),
    limit: options.limit ?? 20,
    membershipWindows: options.membershipWindows ?? OPEN_WINDOW,
    snapshotSequence: options.snapshotSequence ?? 20,
    userId: OWNER_ID,
  });
}

async function searchIds(
  query: string,
  options: Parameters<typeof search>[1] = {}
): Promise<string[]> {
  const rows = await search(query, options);
  return rows.map((row) => row.id);
}

beforeAll(async () => {
  assertLocalTestDatabase();
  await prisma.transaction(async (tx) => {
    await tx.orm.public.Users.createAll(
      [OWNER_ID, PEER_ID, OUTSIDER_ID].map((id) => ({
        displayName: id,
        email: `${id}@example.test`,
        id,
        username: id,
      }))
    );
    await tx.orm.public.MessageConversations.create({
      changeSeq: 20,
      id: CONVERSATION_ID,
      pairKey: [OWNER_ID, PEER_ID].toSorted().join(":"),
    });
    await tx.orm.public.MessageConversationMembers.createAll(
      [OWNER_ID, PEER_ID].map((userId) => ({
        conversationId: CONVERSATION_ID,
        userId,
      }))
    );
    await tx.orm.public.MessageConversationKeys.create({
      conversationId: CONVERSATION_ID,
      encryptedKey: "owner-epoch-one-wrap",
      iv: "owner-wrap-iv",
      ownerUserId: OWNER_ID,
      version: 1,
    });
    await tx.orm.public.Messages.createAll(
      fixtures.map((fixture, index) => ({
        ciphertext: `ciphertext-${fixture.id}`,
        conversationId: CONVERSATION_ID,
        createdAt: toPrismaDateTime(fixture.createdAt),
        creationSequence: fixture.creationSequence,
        deletedAt: fixture.deletedAt
          ? toPrismaDateTime(fixture.deletedAt)
          : null,
        id: fixture.id,
        iv: `iv-${fixture.id}`,
        keyEpoch: fixture.keyEpoch ?? 1,
        ratchetIndex: index + 1,
        revision: fixture.revision ?? 1,
        senderId: PEER_ID,
      }))
    );
    const termTexts = [
      ...new Set(fixtures.flatMap((fixture) => termsForText(fixture.text))),
    ];
    await tx.orm.public.MessageSearchTerms.createAll(
      termTexts.map((normalized) => ({
        conversationId: CONVERSATION_ID,
        gramKeys: gramKeys(normalized),
        normalized,
      }))
    );
    const termRows = await tx.orm.public.MessageSearchTerms.select(
      "id",
      "normalized"
    )
      .where({ conversationId: CONVERSATION_ID })
      .all();
    const termIds = new Map(termRows.map((term) => [term.normalized, term.id]));
    await tx.orm.public.MessageSearchDocuments.createAll(
      fixtures.map((fixture) => ({
        conversationId: CONVERSATION_ID,
        createdAt: toPrismaDateTime(fixture.createdAt),
        messageId: fixture.id,
        revision: fixture.documentRevision ?? fixture.revision ?? 1,
        termIds: termsForText(fixture.text).flatMap((term) => {
          const id = termIds.get(term);
          return id === undefined ? [] : [id];
        }),
      }))
    );
    await tx.orm.public.MessageHiddens.createAll(
      fixtures
        .filter((fixture) => fixture.hidden)
        .map((fixture) => ({ messageId: fixture.id, userId: OWNER_ID }))
    );
  });
  await seedVerifiedMessageEpochFixture(CONVERSATION_ID);
}, 30_000);

afterAll(async () => {
  await prisma.orm.public.MessageSearchDocuments.where({
    conversationId: CONVERSATION_ID,
  }).deleteAndCount();
  await prisma.orm.public.MessageSearchTerms.where({
    conversationId: CONVERSATION_ID,
  }).deleteAndCount();
  await prisma.orm.public.MessageConversations.where({
    id: CONVERSATION_ID,
  }).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in([OWNER_ID, PEER_ID, OUTSIDER_ID])
  ).deleteAndCount();
  await closeMessageSearchPool();
});

describe("indexed DM search candidates", () => {
  test("matches short fragments, URLs, accents, emoji, and scripts without spaces", async () => {
    expect(await searchIds("hi")).toContain(SHORT_ID);
    expect(await searchIds("example.com/path?q=foo")).toContain(URL_ID);
    expect(await searchIds("RÉSUMÉ")).toContain(ACCENT_ID);
    expect(await searchIds("京の")).toContain(SCRIPT_ID);
    expect(await searchIds("🙂🚀")).toContain(EMOJI_ID);
  });

  test("matches query fragments across overlapped long-token chunks", async () => {
    expect(await searchIds("boundary")).toContain(LONG_TOKEN_ID);
  });

  test("requires every query fragment to match the same message", async () => {
    const rows = await search("alpha beta");

    expect(rows.map((row) => row.id)).toEqual([BOTH_TERMS_ID]);
    expect(rows.map((row) => row.id)).not.toContain(ONE_TERM_ID);
  });

  test("filters hidden, deleted, unreadable, stale, and post-snapshot rows before paging", async () => {
    const rows = await search("needle");

    expect(rows.map((row) => row.id)).toEqual([NEEDLE_VISIBLE_ID]);
  });

  test("applies membership windows before limiting candidates", async () => {
    const rows = await search("windowed", {
      limit: 1,
      membershipWindows: [{ after: null, before: windowEnd }],
    });

    expect(rows.map((row) => row.id)).toEqual([WINDOW_VISIBLE_ID]);
  });

  test("uses a stable createdAt and id cursor when timestamps tie", async () => {
    const first = await search("gate", { limit: 1 });
    expect(first.map((row) => row.id)).toEqual([GATE_SECOND_ID]);
    const [firstHit] = first;
    if (!firstHit) {
      throw new Error("Expected the first keyset page to contain a hit");
    }

    const second = await search("gate", {
      before: { createdAt: firstHit.createdAt, messageId: firstHit.id },
      limit: 1,
    });
    expect(second.map((row) => row.id)).toEqual([GATE_FIRST_ID]);
  });

  for (const estimate of [500, 2000, 20_000]) {
    test(`reverse keysets preserve authorization and tied timestamps with estimate ${estimate}`, async () => {
      // Estimates exercise selective, general and broad ordered plans using the same owned fixture.
      await prisma.orm.public.MessageSearchTerms.where({
        conversationId: CONVERSATION_ID,
      }).update({ documentFrequency: estimate });
      try {
        const anchor = { createdAt: baseTime, messageId: "anchor" };
        expect(await searchIds("needle", { after: anchor, limit: 1 })).toEqual([
          NEEDLE_VISIBLE_ID,
        ]);
        expect(
          await searchIds("windowed", {
            after: anchor,
            limit: 1,
            membershipWindows: [{ after: null, before: windowEnd }],
          })
        ).toEqual([WINDOW_VISIBLE_ID]);
        const newer = await search("gate", {
          after: {
            createdAt: new Date(baseTime.getTime() + 16_000),
            messageId: GATE_FIRST_ID,
          },
          limit: 1,
        });
        expect(newer.map((row) => row.id)).toEqual([GATE_SECOND_ID]);
        const reverse = await search("reversepage", {
          after: {
            createdAt: new Date(baseTime.getTime() + 100_000),
            messageId: "anchor",
          },
          limit: 21,
        });
        expect(reverse.map((row) => row.id)).toEqual(
          REVERSE_VISIBLE_IDS.slice(0, 21)
        );
        const boundary = reverse.at(-1);
        if (!boundary) {
          throw new Error("Expected a complete reverse keyset page");
        }
        expect(
          await searchIds("reversepage", {
            after: { createdAt: boundary.createdAt, messageId: boundary.id },
            limit: 21,
          })
        ).toEqual(REVERSE_VISIBLE_IDS.slice(21));
        const forward = await search("reversepage", {
          before: { createdAt: boundary.createdAt, messageId: boundary.id },
          limit: 20,
        });
        expect(forward.map((row) => row.id)).toEqual(
          REVERSE_VISIBLE_IDS.slice(0, 20).toReversed()
        );
      } finally {
        await prisma.orm.public.MessageSearchTerms.where({
          conversationId: CONVERSATION_ID,
        }).update({ documentFrequency: 1 });
      }
    });
  }

  test("rejects ambiguous directional boundaries before opening a query", async () => {
    const cursor = { createdAt: baseTime, messageId: "anchor" };
    await expect(
      search("gate", { after: cursor, before: cursor })
    ).rejects.toThrow("only one cursor");
  });

  test("requires conversation membership and a viewer-owned epoch wrap", async () => {
    const outsiderRows = await searchMessageCandidates({
      conversationId: CONVERSATION_ID,
      fragments: searchFragments("needle"),
      limit: 20,
      membershipWindows: OPEN_WINDOW,
      snapshotSequence: 10,
      userId: OUTSIDER_ID,
    });
    const peerRows = await searchMessageCandidates({
      conversationId: CONVERSATION_ID,
      fragments: searchFragments("needle"),
      limit: 20,
      membershipWindows: OPEN_WINDOW,
      snapshotSequence: 10,
      userId: PEER_ID,
    });

    expect(outsiderRows).toEqual([]);
    expect(peerRows).toEqual([]);
  });
});
