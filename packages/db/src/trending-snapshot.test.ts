import { beforeEach, describe, expect, mock, test } from "bun:test";

// Imported dynamically after mock.module registers, so the module under test
// binds the mocked ../redis instead of the real client.
import type * as SnapshotModule from "./trending-snapshot";

let snapshot: typeof SnapshotModule;

const pipelineCalls: { command: string; args: unknown[] }[] = [];

const mockPipeline = {
  del: mock((key: string) => {
    pipelineCalls.push({ args: [key], command: "del" });
    return mockPipeline;
  }),
  exec: mock(() => []),
  expire: mock((key: string, seconds: number) => {
    pipelineCalls.push({ args: [key, seconds], command: "expire" });
    return mockPipeline;
  }),
  zadd: mock((key: string, ...pairs: (string | number)[]) => {
    pipelineCalls.push({ args: [key, ...pairs], command: "zadd" });
    return mockPipeline;
  }),
};

let mockGenPointer: string | null = "a";
let existingKeys = new Set<string>();
let zrevrangeResult: string[] = [];
let zrevrangebyscoreResult: string[] = [];
let lastZrevrangeArgs: unknown[] = [];
let lastZrevrangebyscoreArgs: unknown[] = [];

const mockRedis = {
  del: mock(() => 1),
  exists: mock((key: string) => (existingKeys.has(key) ? 1 : 0)),
  get: mock((key: string) =>
    key === snapshot.TRENDING_SNAPSHOT_GEN_KEY ? mockGenPointer : null
  ),
  pipeline: () => mockPipeline,
  set: mock((_key: string, value: string) => {
    mockGenPointer = value;
    return "OK";
  }),
  zrevrange: mock((...args: unknown[]) => {
    lastZrevrangeArgs = args;
    return [...zrevrangeResult];
  }),
  zrevrangebyscore: mock((...args: unknown[]) => {
    lastZrevrangebyscoreArgs = args;
    return [...zrevrangebyscoreResult];
  }),
};

mock.module("./redis", () => ({ redis: mockRedis }));

beforeEach(async () => {
  snapshot = await import("./trending-snapshot");
});

describe("trending snapshot cursors", () => {
  test("round-trips generation, score, and post id", () => {
    const encoded = snapshot.encodeTrendingCursor({
      generation: "b",
      postId: "post-123",
      score: 7.25,
    });
    expect(encoded.startsWith("tz1.")).toBe(true);
    expect(snapshot.decodeTrendingCursor(encoded)).toEqual({
      generation: "b",
      postId: "post-123",
      score: 7.25,
    });
  });

  test("rejects foreign cursors and malformed payloads", () => {
    // A legacy bare post id must never be mistaken for a snapshot cursor.
    expect(
      snapshot.decodeTrendingCursor("cmsoxrlww0000m3vnr2xf0v6h")
    ).toBeNull();
    expect(snapshot.decodeTrendingCursor(undefined)).toBeNull();
    expect(snapshot.decodeTrendingCursor("")).toBeNull();
    expect(snapshot.decodeTrendingCursor("tz1.not-valid-base64!!!")).toBeNull();
    const wrongTypes = Buffer.from(
      JSON.stringify({ g: "a", i: 5, s: "fast" })
    ).toString("base64url");
    expect(snapshot.decodeTrendingCursor(`tz1.${wrongTypes}`)).toBeNull();
    const nanScore = Buffer.from(
      JSON.stringify({ g: "a", i: "p", s: "NaN" })
    ).toString("base64url");
    expect(snapshot.decodeTrendingCursor(`tz1.${nanScore}`)).toBeNull();
  });
});

describe("withUniqueTiebreak", () => {
  test("gives equal scores a strict descending order across ranks", () => {
    const [first, second, third] = [12, 12, 12].map((score, rank) =>
      snapshot.withUniqueTiebreak(score, rank)
    );
    expect(first).toBeGreaterThan(second as number);
    expect(second).toBeGreaterThan(third as number);
    // The perturbation is invisible relative to the score itself.
    expect(first).toBeCloseTo(12, 3);
  });

  test("preserves ordering of distinct scores, including negatives", () => {
    const ranked = [40, 0, -50].map((score, rank) =>
      snapshot.withUniqueTiebreak(score, rank)
    );
    for (let index = 1; index < ranked.length; index += 1) {
      const previous = ranked[index - 1] ?? 0;
      expect(previous).toBeGreaterThan(ranked[index] ?? 0);
    }
  });
});

describe("publishTrendingSnapshot", () => {
  beforeEach(() => {
    pipelineCalls.length = 0;
    mockGenPointer = "a";
    mockPipeline.exec.mockClear();
    mockRedis.set.mockClear();
  });

  test("writes the alternate generation in strict order, then flips the pointer", async () => {
    const published = await snapshot.publishTrendingSnapshot([
      { id: "p-tie-2", score: 9 },
      { id: "p-top", score: 20 },
      { id: "p-tie-1", score: 9 },
    ]);

    expect(published).toBe(3);
    const shadowKey = `${snapshot.TRENDING_SNAPSHOT_KEY_PREFIX}b`;
    const commands = pipelineCalls.map((call) => call.command);
    // Shadow is cleared before writing, expired after, pointer flipped last.
    expect(commands.indexOf("del")).toBeLessThan(commands.indexOf("zadd"));
    expect(commands.indexOf("zadd")).toBeLessThan(commands.indexOf("expire"));

    const zadd = pipelineCalls.find((call) => call.command === "zadd");
    expect(zadd?.args[0]).toBe(shadowKey);
    const pairs = zadd?.args.slice(1) as (number | string)[];
    // Score desc, id asc within ties, each perturbed by rank.
    expect(pairs).toEqual([
      snapshot.withUniqueTiebreak(20, 0),
      "p-top",
      snapshot.withUniqueTiebreak(9, 1),
      "p-tie-1",
      snapshot.withUniqueTiebreak(9, 2),
      "p-tie-2",
    ]);
    expect(mockGenPointer).toBe("b");
  });

  test("alternates generations so pinned readers keep their snapshot", async () => {
    await snapshot.publishTrendingSnapshot([{ id: "p1", score: 5 }]);
    expect(mockGenPointer).toBe("b");
    await snapshot.publishTrendingSnapshot([{ id: "p2", score: 6 }]);
    expect(mockGenPointer).toBe("a");
  });

  test("skips publishing an empty window, keeping the current snapshot", async () => {
    const published = await snapshot.publishTrendingSnapshot([]);
    expect(published).toBe(0);
    expect(pipelineCalls).toEqual([]);
    expect(mockGenPointer).toBe("a");
  });
});

describe("fetchTrendingSnapshotPage", () => {
  beforeEach(() => {
    mockGenPointer = "a";
    existingKeys = new Set([`${snapshot.TRENDING_SNAPSHOT_KEY_PREFIX}a`]);
    zrevrangeResult = [];
    zrevrangebyscoreResult = [];
    lastZrevrangeArgs = [];
    lastZrevrangebyscoreArgs = [];
  });

  test("serves the first page from the current generation", async () => {
    zrevrangeResult = ["p-top", "9.5", "p-next", "3"];
    const page = await snapshot.fetchTrendingSnapshotPage({ pageSize: 20 });

    expect(page).not.toBeNull();
    expect(page?.generation).toBe("a");
    expect(page?.entries).toEqual([
      { id: "p-top", score: 9.5 },
      { id: "p-next", score: 3 },
    ]);
    const key = `${snapshot.TRENDING_SNAPSHOT_KEY_PREFIX}a`;
    expect(lastZrevrangeArgs.slice(0, 3)).toEqual([key, 0, 39]);
    expect(lastZrevrangeArgs.at(-1)).toBe("WITHSCORES");
  });

  test("pages strictly after the cursor's score inside the pinned generation", async () => {
    existingKeys.add(`${snapshot.TRENDING_SNAPSHOT_KEY_PREFIX}b`);
    zrevrangebyscoreResult = ["p-lower", "2"];
    const cursor = snapshot.encodeTrendingCursor({
      generation: "b",
      postId: "p-mid",
      score: 4.5,
    });
    const page = await snapshot.fetchTrendingSnapshotPage({
      cursorRaw: cursor,
      pageSize: 20,
    });

    expect(page?.entries).toEqual([{ id: "p-lower", score: 2 }]);
    expect(page?.generation).toBe("b");
    const key = `${snapshot.TRENDING_SNAPSHOT_KEY_PREFIX}b`;
    expect(lastZrevrangebyscoreArgs.slice(0, 5)).toEqual([
      key,
      "(4.5",
      "-inf",
      "WITHSCORES",
      "LIMIT",
    ]);
  });

  test("falls back when the cursor cannot be decoded", async () => {
    const page = await snapshot.fetchTrendingSnapshotPage({
      cursorRaw: "some-legacy-post-id",
      pageSize: 20,
    });
    expect(page).toBeNull();
  });

  test("falls back when there is no published snapshot yet", async () => {
    mockGenPointer = null;
    const page = await snapshot.fetchTrendingSnapshotPage({ pageSize: 20 });
    expect(page).toBeNull();
  });

  test("falls back when the pinned generation has expired", async () => {
    existingKeys = new Set();
    const cursor = snapshot.encodeTrendingCursor({
      generation: "b",
      postId: "p",
      score: 1,
    });
    const page = await snapshot.fetchTrendingSnapshotPage({
      cursorRaw: cursor,
      pageSize: 20,
    });
    expect(page).toBeNull();
  });

  test("an empty pinned window falls back instead of ending the feed", async () => {
    const page = await snapshot.fetchTrendingSnapshotPage({ pageSize: 20 });
    expect(page).toBeNull();
  });

  test("flags possiblyMore only when the fetch hit its limit", async () => {
    zrevrangeResult = Array.from({ length: 40 }, (_, i) =>
      i % 2 === 0 ? `p${i / 2}` : String(100 - i / 2)
    );
    const page = await snapshot.fetchTrendingSnapshotPage({ pageSize: 20 });
    expect(page?.possiblyMore).toBe(true);

    zrevrangeResult = ["p-only", "1"];
    const short = await snapshot.fetchTrendingSnapshotPage({ pageSize: 20 });
    expect(short?.possiblyMore).toBe(false);
  });
});
