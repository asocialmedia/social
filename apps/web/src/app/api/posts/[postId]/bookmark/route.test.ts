import { beforeEach, describe, expect, mock, test } from "bun:test";

const POST_ID = "post1";
const AUTHOR_ID = "author1";
const BOOKMARKER_ID = "bookmarker1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: BOOKMARKER_ID },
}));

const state = {
  bookmarkerAura: 0,
  authorAura: 0,
  auraLogs: [] as Record<string, unknown>[],
  isBookmarked: false as boolean,
};

function resetState() {
  state.bookmarkerAura = 0;
  state.authorAura = 0;
  state.auraLogs = [];
  state.isBookmarked = false;
}

const mockTx = {
  bookmark: {
    create: () => {
      state.isBookmarked = true;
    },
    deleteMany: () => {
      state.isBookmarked = false;
    },
    findUnique: () => (state.isBookmarked ? { id: "b1" } : null),
  },
  user: {
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
    },
  },
  auraLog: {
    create: (args: { data: Record<string, unknown> }) => {
      state.auraLogs.push(args.data);
    },
    // Simulates that the deleted bookmark was created after this feature
    // shipped and therefore earned aura.
    findFirst: () => ({ id: "log-1" }),
  },
};

const mockPrisma = {
  $transaction: (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
  bookmark: {
    create: mockTx.bookmark.create,
    deleteMany: mockTx.bookmark.deleteMany,
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

mock.module("@asm/db", () => ({
  prisma: mockPrisma,
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

import { DELETE, GET, POST } from "./route";

const context = { params: Promise.resolve({ postId: POST_ID }) };

function request(method: string): Request {
  return new Request(`http://localhost/api/posts/${POST_ID}/bookmark`, {
    method,
  });
}

describe("POST /api/posts/[postId]/bookmark", () => {
  beforeEach(() => {
    resetState();
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

  test("bookmarking credits aura to the bookmarker and the post author", async () => {
    const res = await POST(request("POST"), context);

    expect(res.status).toBe(200);
    expect(state.isBookmarked).toBe(true);
    expect(state.bookmarkerAura).toBe(1);
    expect(state.authorAura).toBe(1);
    expect(state.auraLogs).toEqual([
      {
        userId: BOOKMARKER_ID,
        issuerId: BOOKMARKER_ID,
        amount: 1,
        type: "POST_BOOKMARKED",
        postId: POST_ID,
      },
      {
        userId: AUTHOR_ID,
        issuerId: BOOKMARKER_ID,
        amount: 1,
        type: "POST_BOOKMARK_RECEIVED",
        postId: POST_ID,
      },
    ]);
  });

  test("re-bookmarking is a no-op and awards no aura", async () => {
    state.isBookmarked = true;
    state.bookmarkerAura = 1;
    state.authorAura = 1;

    const res = await POST(request("POST"), context);

    expect(res.status).toBe(200);
    expect(state.isBookmarked).toBe(true);
    expect(state.bookmarkerAura).toBe(1);
    expect(state.authorAura).toBe(1);
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

  test("removing a bookmark revokes aura from the bookmarker and the author", async () => {
    state.isBookmarked = true;
    state.bookmarkerAura = 1;
    state.authorAura = 1;

    const res = await DELETE(request("DELETE"), context);

    expect(res.status).toBe(200);
    expect(state.isBookmarked).toBe(false);
    expect(state.bookmarkerAura).toBe(0);
    expect(state.authorAura).toBe(0);
    expect(state.auraLogs).toEqual([
      {
        userId: BOOKMARKER_ID,
        issuerId: BOOKMARKER_ID,
        amount: -1,
        type: "POST_BOOKMARKED",
        postId: POST_ID,
      },
      {
        userId: AUTHOR_ID,
        issuerId: BOOKMARKER_ID,
        amount: -1,
        type: "POST_BOOKMARK_RECEIVED",
        postId: POST_ID,
      },
    ]);
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
