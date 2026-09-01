import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

const USER_ID = "user1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

interface SnapshotEntry {
  id: string;
  score: number;
}

// Mirrors the real codec so cursor assertions stay honest without importing
// the mocked barrel's implementation.
const encodeCursor = (entry: SnapshotEntry, generation: string): string =>
  `tz1.${Buffer.from(
    JSON.stringify({ g: generation, i: entry.id, s: entry.score })
  ).toString("base64url")}`;

let snapshotPage: {
  entries: SnapshotEntry[];
  generation: string;
  possiblyMore: boolean;
} | null = null;
let snapshotThrows = false;

interface Row {
  aura?: number;
  content?: string;
  id: string;
  moderated?: boolean;
  trendingScore?: number;
}

let pgPosts: Row[] = [];
let lastLegacyArgs: {
  cursor?: { id: string };
  include?: unknown;
  orderBy?: unknown;
  take?: number;
  where?: unknown;
} | null = null;

const rowsById = new Map<string, Row>();

const mockPrisma = {
  post: {
    findMany: mock(
      (args?: {
        cursor?: { id: string };
        include?: unknown;
        orderBy?: unknown;
        take?: number;
        where?: unknown;
      }) => {
        if (!args?.orderBy) {
          // Include-fetch for snapshot ids, order-independent.
          const where = args?.where as { id: { in: string[] } } | undefined;
          const wanted = where?.id.in ?? [];
          return wanted
            .map((id) => rowsById.get(id))
            .filter((row): row is Row => row !== undefined);
        }
        // Legacy live-ordering query.
        lastLegacyArgs = args ?? null;
        return [...pgPosts]
          .toSorted((a, b) => (b.trendingScore ?? 0) - (a.trendingScore ?? 0))
          .slice(0, args?.take ?? 21);
      }
    ),
  },
};

const mockHydrate = mock((posts: unknown[]) => posts);

const mockFetchSnapshotPage = mock((_args: unknown) => snapshotPage);
const mockEncodeCursor = mock(
  (cursor: { generation: string; postId: string; score: number }) =>
    encodeCursor({ id: cursor.postId, score: cursor.score }, cursor.generation)
);

mock.module("@asm/db", () => ({
  encodeTrendingCursor: mockEncodeCursor,
  fetchTrendingSnapshotPage: mockFetchSnapshotPage,
  getPersonalizedFeedPage: () => ({ anchorCursor: null, posts: [] }),
  getPostDataInclude: () => ({ user: true, vote: true }),
  hydrateViewCounts: mockHydrate,
  isTrendingSnapshotCursor: (raw: string | undefined | null) =>
    Boolean(raw && raw.startsWith("tz1.")),
  prisma: mockPrisma,
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("GET /api/posts/trending", () => {
  beforeEach(() => {
    snapshotPage = null;
    snapshotThrows = false;
    pgPosts = [];
    rowsById.clear();
    lastLegacyArgs = null;
    mockGetSession.mockClear();
    mockFetchSnapshotPage.mockClear();
    mockEncodeCursor.mockClear();
    mockHydrate.mockClear();
    mockPrisma.post.findMany.mockClear();
  });

  describe("snapshot path", () => {
    const fullEntries = Array.from({ length: 20 }, (_, index) => ({
      id: `p${index}`,
      score: 100 - index,
    }));

    test("serves the frozen ranking and pins a generation cursor", async () => {
      snapshotPage = {
        entries: fullEntries,
        generation: "b",
        possiblyMore: true,
      };
      for (const entry of fullEntries) {
        rowsById.set(entry.id, { content: "hi", id: entry.id });
      }

      const res = await GET(new Request("http://localhost/api/posts/trending"));

      expect(res.status).toBe(200);
      const body = await res.json();
      // Snapshot order survives verbatim - no DB re-ranking.
      expect(body.posts.map((p: Row) => p.id)).toEqual(
        fullEntries.map((entry) => entry.id)
      );
      const lastEntry = fullEntries.at(-1);
      expect(body.nextCursor).toBe(
        encodeCursor(lastEntry as SnapshotEntry, "b")
      );
      // Snapshot path never runs the legacy ranked query.
      expect(lastLegacyArgs).toBeNull();

      const forwarded = mockFetchSnapshotPage.mock.calls[0]?.[0] as {
        pageSize: number;
      };
      expect(forwarded.pageSize).toBe(20);
    });

    test("drops posts deleted or newly moderated since publication", async () => {
      snapshotPage = {
        entries: [
          { id: "keep-1", score: 30 },
          { id: "deleted", score: 25 },
          { id: "moderated", score: 20 },
          { id: "keep-2", score: 15 },
        ],
        generation: "a",
        possiblyMore: false,
      };
      rowsById.set("keep-1", { id: "keep-1" });
      rowsById.set("moderated", { id: "moderated", moderated: true });
      rowsById.set("keep-2", { id: "keep-2" });

      const res = await GET(
        new Request("http://localhost/api/posts/trending?excludeModerated=1")
      );

      const body = await res.json();
      expect(body.posts.map((p: Row) => p.id)).toEqual(["keep-1", "keep-2"]);
      // Short page after filtering: the scroll ends inside this generation.
      expect(body.nextCursor).toBeNull();
    });

    test("pages inside the pinned generation and ends when it runs dry", async () => {
      snapshotPage = {
        entries: [
          { id: "older-1", score: 8 },
          { id: "older-2", score: 7 },
        ],
        generation: "b",
        possiblyMore: false,
      };
      rowsById.set("older-1", { id: "older-1" });
      rowsById.set("older-2", { id: "older-2" });

      const cursor = encodeCursor({ id: "p-prev", score: 9 }, "b");
      const res = await GET(
        new Request(`http://localhost/api/posts/trending?cursor=${cursor}`)
      );

      // The pinned generation (not the current pointer) is what gets read.
      expect(mockFetchSnapshotPage).toHaveBeenCalledWith({
        cursorRaw: cursor,
        pageSize: 20,
      });

      const body = await res.json();
      expect(body.posts.map((p: Row) => p.id)).toEqual(["older-1", "older-2"]);
      // Short page inside a drained generation: scroll over.
      expect(body.nextCursor).toBeNull();
    });

    test("falls back to live Postgres when the snapshot is unavailable", async () => {
      snapshotPage = null;
      pgPosts = [
        { aura: 80, id: "p2", trendingScore: 9.5 },
        { aura: 30, id: "p1", trendingScore: 3.5 },
      ];

      const res = await GET(new Request("http://localhost/api/posts/trending"));

      expect(res.status).toBe(200);
      expect(lastLegacyArgs?.orderBy).toEqual([
        { trendingScore: "desc" },
        { id: "desc" },
      ]);
      const body = await res.json();
      expect(body.posts.map((p: Row) => p.id)).toEqual(["p2", "p1"]);
    });

    test("falls back when Redis or the snapshot reader throws", async () => {
      snapshotThrows = true;
      mockFetchSnapshotPage.mockImplementation(() => {
        if (snapshotThrows) {
          throw new Error("redis down");
        }
        return null;
      });
      pgPosts = [{ id: "p1", trendingScore: 5 }];

      const res = await GET(new Request("http://localhost/api/posts/trending"));

      expect(res.status).toBe(200);
      expect(lastLegacyArgs).not.toBeNull();
      const body = await res.json();
      expect(body.posts.map((p: Row) => p.id)).toEqual(["p1"]);
    });
  });

  describe("legacy contract", () => {
    beforeEach(() => {
      // No snapshot published: every request exercises the fallback path,
      // preserving today's behavior byte-for-byte.
      snapshotPage = null;
      pgPosts = [
        { aura: 30, id: "p1", trendingScore: 3.5 },
        { aura: 80, id: "p2", trendingScore: 9.25 },
        { aura: 50, id: "p3", trendingScore: 6 },
      ];
    });

    test("allows guests to browse the trending feed", async () => {
      mockGetSession.mockResolvedValueOnce(null);

      const res = await GET(new Request("http://localhost/api/posts/trending"));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.posts.map((p: Row) => p.id)).toEqual(["p2", "p3", "p1"]);
    });

    test("ranks by time-decayed trending score descending", async () => {
      const res = await GET(new Request("http://localhost/api/posts/trending"));

      expect(res.status).toBe(200);
      expect(lastLegacyArgs?.orderBy).toEqual([
        { trendingScore: "desc" },
        { id: "desc" },
      ]);

      const body = await res.json();
      expect(body.posts.map((p: Row) => p.id)).toEqual(["p2", "p3", "p1"]);
      expect(body.nextCursor).toBeNull();
    });

    test("returns a nextCursor when there are more posts than the page size", async () => {
      pgPosts = Array.from({ length: 25 }, (_, i) => ({
        id: `p${i}`,
        trendingScore: 100 - i,
      }));

      const res = await GET(new Request("http://localhost/api/posts/trending"));

      const body = await res.json();
      expect(body.posts).toHaveLength(20);
      expect(lastLegacyArgs?.take).toBe(21);
      expect(body.nextCursor).toBe("p20");
    });

    test("includes moderated posts by default", async () => {
      await GET(new Request("http://localhost/api/posts/trending"));
      expect(lastLegacyArgs?.where).toEqual({ isGust: false });
    });

    test("excludes moderated posts only when excludeModerated=1", async () => {
      const req = new Request(
        "http://localhost/api/posts/trending?excludeModerated=1"
      );
      await GET(req);
      expect(lastLegacyArgs?.where).toEqual({
        isGust: false,
        moderated: false,
      });
    });

    test("handles expired exp. cursor and strips prefix for live Postgres query", async () => {
      const req = new Request(
        "http://localhost/api/posts/trending?cursor=exp.p-anchor"
      );
      await GET(req);
      expect(lastLegacyArgs?.cursor).toEqual({ id: "p-anchor" });
    });
  });
});
