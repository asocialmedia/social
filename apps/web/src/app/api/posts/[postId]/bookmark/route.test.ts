import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DELETE, GET, POST } from "./route";

const POST_ID = "post1";
const AUTHOR_ID = "author1";
const BOOKMARKER_ID = "bookmarker1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: BOOKMARKER_ID },
}));

// Open positions stored on the bookmark row (what un-bookmarking unwinds).
const state = {
  auraLogs: [] as Record<string, unknown>[],
  authorAura: 0,
  bookmarkRow: null as null | { authorAura: number; bookmarkerAura: number },
  bookmarkerAura: 0,
  isBookmarked: false as boolean,
};

function resetState() {
  state.bookmarkerAura = 0;
  state.authorAura = 0;
  state.auraLogs = [];
  state.isBookmarked = false;
  state.bookmarkRow = null;
}

const mockTx = {
  auraLog: {
    create: (args: { data: Record<string, unknown> }) => {
      state.auraLogs.push(args.data);
    },
  },
  bookmark: {
    create: (args: {
      data: { authorAura?: number; bookmarkerAura?: number };
    }) => {
      state.isBookmarked = true;
      state.bookmarkRow = {
        authorAura: args.data.authorAura ?? 0,
        bookmarkerAura: args.data.bookmarkerAura ?? 0,
      };
    },
    deleteMany: () => {
      // Mirrors Prisma's real contract: returns how many rows were removed.
      const existed = state.isBookmarked;
      state.isBookmarked = false;
      return Promise.resolve({ count: existed ? 1 : 0 });
    },
    findUnique: () =>
      state.isBookmarked
        ? {
            authorAura: state.bookmarkRow?.authorAura ?? 0,
            bookmarkerAura: state.bookmarkRow?.bookmarkerAura ?? 0,
            id: "b1",
          }
        : null,
  },
  user: {
    findUnique: () =>
      // Actor snapshot for credibility weighting; amount is mocked below.
      Promise.resolve({ aura: 500, createdAt: new Date(0) }),
    update: (args: {
      data: { aura?: { decrement?: number; increment?: number } };
      where: { id: string };
    }) => {
      const delta =
        (args.data.aura?.increment ?? 0) - (args.data.aura?.decrement ?? 0);
      if (args.where.id === BOOKMARKER_ID) {
        state.bookmarkerAura += delta;
      }
      if (args.where.id === AUTHOR_ID) {
        state.authorAura += delta;
      }
      return Promise.resolve({});
    },
  },
};

// Mock ledger helpers mirroring the real contracts narrowly enough to verify
// route orchestration: flat curation stipend, weighted author recognition
// (fixed here at 2 of a base 4 to represent a mid-credibility bookmarker),
// and exact stored-position reversal. The math itself is covered by
// packages/db/src/aura/*.test.ts.
let nextWeightedAmount = 2;

const mockDb = () => ({
  BOOKMARK_GIVEN_AURA: 1,
  BOOKMARK_RECEIVED_AURA: 4,
  applyFlatAward: (
    tx: typeof mockTx,
    args: {
      baseAmount: number;
      postId: string;
      recipientId: string;
      type: string;
    }
  ) => {
    tx.user.update({
      data: { aura: { increment: args.baseAmount } },
      where: { id: args.recipientId },
    });
    tx.auraLog.create({
      data: {
        amount: args.baseAmount,
        issuerId: args.recipientId,
        postId: args.postId,
        targetUserId: args.recipientId,
        type: args.type,
        userId: args.recipientId,
      },
    });
    return Promise.resolve({ amount: args.baseAmount });
  },
  applyWeightedAward: (
    tx: typeof mockTx,
    args: {
      actorId: string;
      baseAmount: number;
      postId: string;
      recipientId: string;
      type: string;
    }
  ) => {
    tx.user.update({
      data: { aura: { increment: nextWeightedAmount } },
      where: { id: args.recipientId },
    });
    tx.auraLog.create({
      data: {
        amount: nextWeightedAmount,
        issuerId: args.actorId,
        postId: args.postId,
        targetUserId: args.recipientId,
        type: args.type,
        userId: args.recipientId,
      },
    });
    return Promise.resolve({ amount: nextWeightedAmount });
  },
  invalidateAuraSignals: () => Promise.resolve(),
  prisma: mockPrisma,
  reverseExactAura: (
    tx: typeof mockTx,
    args: {
      issuerId: string;
      openAmount: number;
      postId: string;
      recipientId: string;
      targetUserId?: string;
      type: string;
    }
  ) => {
    if (args.openAmount === 0) {
      return Promise.resolve({ amount: 0 });
    }
    const reversed = -args.openAmount;
    tx.user.update({
      data: { aura: { increment: reversed } },
      where: { id: args.recipientId },
    });
    tx.auraLog.create({
      data: {
        amount: reversed,
        issuerId: args.issuerId,
        postId: args.postId,
        targetUserId: args.targetUserId ?? args.recipientId,
        type: args.type,
        userId: args.recipientId,
      },
    });
    return Promise.resolve({ amount: reversed });
  },
});

const mockPrisma = {
  $transaction: (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
  bookmark: {
    findUnique: mockTx.bookmark.findUnique,
  },
  post: {
    findUnique: (
      args: { where: { id: string } } & {
        select?: unknown;
      }
    ) => {
      if (args.where.id !== POST_ID) {
        return null;
      }
      return { id: POST_ID, userId: AUTHOR_ID };
    },
  },
};

mock.module("@asm/db", () => mockDb());

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

const context = { params: Promise.resolve({ postId: POST_ID }) };

function request(method: string): Request {
  return new Request(`http://localhost/api/posts/${POST_ID}/bookmark`, {
    method,
  });
}

describe("POST /api/posts/[postId]/bookmark", () => {
  beforeEach(() => {
    resetState();
    nextWeightedAmount = 2;
    mockGetSession.mockClear();
  });

  test("rejects unauthenticated requests", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await POST(request("POST"), context);

    expect(res.status).toBe(401);
    expect(state.bookmarkerAura).toBe(0);
    expect(state.authorAura).toBe(0);
  });

  test("returns 404 when the post does not exist", async () => {
    const missingContext = {
      params: Promise.resolve({ postId: "missing" }),
    };
    const res = await POST(request("POST"), missingContext);

    expect(res.status).toBe(404);
  });

  test("bookmarking credits the bookmarker (flat) and the author (weighted)", async () => {
    const res = await POST(request("POST"), context);

    expect(res.status).toBe(200);
    expect(state.isBookmarked).toBe(true);
    // Flat curation stipend vs weighted author recognition.
    expect(state.bookmarkerAura).toBe(1);
    expect(state.authorAura).toBe(2);
    // Stored positions match what was actually applied.
    expect(state.bookmarkRow).toEqual({ authorAura: 2, bookmarkerAura: 1 });
    expect(state.auraLogs).toEqual([
      {
        amount: 1,
        issuerId: BOOKMARKER_ID,
        postId: POST_ID,
        targetUserId: BOOKMARKER_ID,
        type: "POST_BOOKMARKED",
        userId: BOOKMARKER_ID,
      },
      {
        amount: 2,
        issuerId: BOOKMARKER_ID,
        postId: POST_ID,
        targetUserId: AUTHOR_ID,
        type: "POST_BOOKMARK_RECEIVED",
        userId: AUTHOR_ID,
      },
    ]);
  });

  test("re-bookmarking is a no-op and awards no aura", async () => {
    state.isBookmarked = true;
    state.bookmarkRow = { authorAura: 2, bookmarkerAura: 1 };
    state.bookmarkerAura = 1;
    state.authorAura = 2;

    const res = await POST(request("POST"), context);

    expect(res.status).toBe(200);
    expect(state.isBookmarked).toBe(true);
    expect(state.bookmarkerAura).toBe(1);
    expect(state.authorAura).toBe(2);
    expect(state.auraLogs).toEqual([]);
  });

  test("bookmarking your own post records it but awards no aura", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: AUTHOR_ID } });

    const res = await POST(request("POST"), context);

    expect(res.status).toBe(200);
    expect(state.isBookmarked).toBe(true);
    expect(state.bookmarkerAura).toBe(0);
    expect(state.authorAura).toBe(0);
    expect(state.auraLogs).toEqual([]);
  });
});

describe("DELETE /api/posts/[postId]/bookmark", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
  });

  test("removing a bookmark reverses exactly the stored positions", async () => {
    state.isBookmarked = true;
    state.bookmarkRow = { authorAura: 2, bookmarkerAura: 1 };
    state.bookmarkerAura = 1;
    state.authorAura = 2;

    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(200);
    expect(state.isBookmarked).toBe(false);
    expect(state.bookmarkerAura).toBe(0);
    expect(state.authorAura).toBe(0);
    expect(state.auraLogs).toEqual([
      {
        amount: -1,
        issuerId: BOOKMARKER_ID,
        postId: POST_ID,
        targetUserId: BOOKMARKER_ID,
        type: "POST_BOOKMARKED",
        userId: BOOKMARKER_ID,
      },
      {
        amount: -2,
        issuerId: BOOKMARKER_ID,
        postId: POST_ID,
        targetUserId: AUTHOR_ID,
        type: "POST_BOOKMARK_RECEIVED",
        userId: AUTHOR_ID,
      },
    ]);
  });

  test("a legacy bookmark with zero stored positions reverses nothing", async () => {
    // Bookmarks created before the economy shipped carry zeros: conservative
    // under-refund instead of recomputing history.
    state.isBookmarked = true;
    state.bookmarkRow = { authorAura: 0, bookmarkerAura: 0 };
    state.bookmarkerAura = 1;
    state.authorAura = 1;

    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(200);
    expect(state.isBookmarked).toBe(false);
    expect(state.bookmarkerAura).toBe(1);
    expect(state.authorAura).toBe(1);
    expect(state.auraLogs).toEqual([]);
  });

  test("a racing unbookmark whose delete removes no rows never double-debits aura", async () => {
    // Simulates the loser of a concurrent DELETE race: the bookmark is already
    // gone (deleteMany returns count 0), so the reversal must not run again.
    state.isBookmarked = false;
    state.bookmarkRow = { authorAura: 2, bookmarkerAura: 1 };
    state.bookmarkerAura = 0;
    state.authorAura = 0;
    state.auraLogs = [
      { amount: -1, type: "POST_BOOKMARKED" },
      { amount: -2, type: "POST_BOOKMARK_RECEIVED" },
    ];

    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(200);
    expect(state.bookmarkerAura).toBe(0);
    expect(state.authorAura).toBe(0);
    expect(state.auraLogs).toHaveLength(2);
  });
});

describe("GET /api/posts/[postId]/bookmark", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
  });

  test("returns the bookmark state for the current user", async () => {
    state.isBookmarked = true;

    const res = await GET(request("GET"), context);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ isBookmarkedByUser: true });
  });
});
