// Frozen trending rankings in Redis. The Postgres trendingScore column keeps
// changing every flush interval, which makes deep id-cursor scrolls drift
// (duplicates/skips) mid-session. Instead the worker publishes each recompute
// as a versioned ZSET snapshot; readers pin one generation through their
// cursor, so a scroll sees one immutable ranking even while newer snapshots
// rotate in behind it.

import { createLogger } from "@asm/logger";

import { redis } from "./redis";

const logger = createLogger({ serviceName: "trending-snapshot" });

export const TRENDING_SNAPSHOT_KEY_PREFIX = "trending:snapshot:";
export const TRENDING_SNAPSHOT_GEN_KEY = "trending:snapshot:gen";

// Snapshots must outlive the scroll sessions pinned to them. Three flush
// intervals of TTL covers a couple of missed worker runs before a pinned
// generation evaporates and its scroll gracefully restarts.
export const TRENDING_SNAPSHOT_TTL_SECONDS = 900;

// Two alternating generations: readers pin whichever they started on while
// the worker writes the other and flips the pointer only after it is complete.
type SnapshotGeneration = "a" | "b";

// Cursor marker + version so future formats can coexist; everything that
// does not parse is treated as "no cursor".
const CURSOR_PREFIX = "tz1.";

// Equal trending scores would make ZSET iteration order depend on Redis'
// internal lex behavior alone; subtracting a tiny per-rank epsilon gives the
// snapshot a strict total order (score desc, then id asc) that survives
// float64 rounding for any realistic score magnitude.
const TIEBREAK_EPSILON = 1e-6;

export interface TrendingSnapshotEntry {
  id: string;
  score: number;
}

export interface TrendingSnapshotCursor {
  generation: string;
  postId: string;
  score: number;
}

// True when a raw cursor belongs to the snapshot scheme rather than a bare
// post id. Callers falling back from an unusable snapshot to live Postgres
// ordering must strip these before using the value as a Prisma id cursor -
// a tz1-prefixed payload is never a valid post id.
export function isTrendingSnapshotCursor(
  raw: string | undefined | null
): boolean {
  return Boolean(raw && raw.startsWith(CURSOR_PREFIX));
}

// Wire shape inside the encoded payload (shortened keys keep cursors small).
interface EncodedTrendingCursor {
  g: unknown;
  i: unknown;
  s: unknown;
}

// Applies the per-rank tiebreak for the entry at `rank` (0-based) of the
// score-desc, id-asc ordered list. Exported for tests and publishers.
export function withUniqueTiebreak(score: number, rank: number): number {
  return score - rank * TIEBREAK_EPSILON;
}

export function encodeTrendingCursor(cursor: TrendingSnapshotCursor): string {
  const payload = Buffer.from(
    JSON.stringify({
      g: cursor.generation,
      i: cursor.postId,
      s: cursor.score,
    })
  ).toString("base64url");
  return `${CURSOR_PREFIX}${payload}`;
}

export function decodeTrendingCursor(
  raw?: string | null
): TrendingSnapshotCursor | null {
  if (!raw || !raw.startsWith(CURSOR_PREFIX)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(raw.slice(CURSOR_PREFIX.length), "base64url").toString(
        "utf-8"
      )
    ) as Partial<EncodedTrendingCursor>;
    if (
      typeof parsed.g !== "string" ||
      typeof parsed.i !== "string" ||
      typeof parsed.s !== "number" ||
      Number.isNaN(parsed.s)
    ) {
      return null;
    }
    return { generation: parsed.g, postId: parsed.i, score: parsed.s };
  } catch {
    return null;
  }
}

// Publishes a full recompute as the next generation and flips the pointer
// only after the new ZSET is complete. Empty windows skip publishing so the
// previous generation keeps serving until its TTL.
export async function publishTrendingSnapshot(
  entries: TrendingSnapshotEntry[]
): Promise<number> {
  if (entries.length === 0) {
    return 0;
  }

  const currentGeneration = (await redis.get(
    TRENDING_SNAPSHOT_GEN_KEY
  )) as SnapshotGeneration | null;
  const nextGeneration: SnapshotGeneration =
    currentGeneration === "a" ? "b" : "a";
  const key = `${TRENDING_SNAPSHOT_KEY_PREFIX}${nextGeneration}`;

  // Strict total order: score desc, then id ascending.
  const ordered = [...entries].toSorted((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.id < b.id ? -1 : 1;
  });

  const pipeline = redis.pipeline();
  pipeline.del(key);
  const CHUNK_SIZE = 500;
  for (let start = 0; start < ordered.length; start += CHUNK_SIZE) {
    const chunk = ordered.slice(start, start + CHUNK_SIZE);
    const flat: (string | number)[] = [];
    for (const [offset, entry] of chunk.entries()) {
      flat.push(withUniqueTiebreak(entry.score, start + offset), entry.id);
    }
    pipeline.zadd(key, ...flat);
  }
  pipeline.expire(key, TRENDING_SNAPSHOT_TTL_SECONDS);
  await pipeline.exec();

  // Flip last: readers only ever see a fully written generation.
  await redis.set(
    TRENDING_SNAPSHOT_GEN_KEY,
    nextGeneration,
    "EX",
    TRENDING_SNAPSHOT_TTL_SECONDS
  );

  logger.debug(
    { entries: ordered.length, generation: nextGeneration },
    "trending snapshot published"
  );
  return ordered.length;
}

export interface TrendingSnapshotPage {
  // Raw entries in snapshot order (score desc, id asc). Callers filter
  // against Postgres (deleted/moderated) before slicing the page.
  entries: TrendingSnapshotEntry[];
  generation: string;
  // True when the fetch already asked for the maximum batch size, meaning
  // more entries may exist beyond this page.
  possiblyMore: boolean;
}

// How many extra entries readers pull beyond the page size to absorb posts
// that vanished from Postgres or got filtered between snapshot and serve.
const OVERFETCH_BUFFER = 20;

// Reads one page slice from the pinned generation. Returns null whenever the
// snapshot cannot serve this request (no snapshot yet, unknown/expired
// generation, unreadable cursor, Redis trouble upstream) so callers can fall
// back to the live Postgres ordering.
export async function fetchTrendingSnapshotPage(options: {
  cursorRaw?: string;
  pageSize: number;
}): Promise<TrendingSnapshotPage | null> {
  const { cursorRaw, pageSize } = options;
  const limit = pageSize + OVERFETCH_BUFFER;

  let generation: SnapshotGeneration | string | null;
  let exclusiveMaxScore: number | null = null;
  if (cursorRaw) {
    const decoded = decodeTrendingCursor(cursorRaw);
    if (!decoded) {
      return null;
    }
    ({ generation } = decoded);
    exclusiveMaxScore = decoded.score;
  } else {
    generation = await redis.get(TRENDING_SNAPSHOT_GEN_KEY);
    if (!generation) {
      return null;
    }
  }

  const key = `${TRENDING_SNAPSHOT_KEY_PREFIX}${generation}`;
  if (!(await redis.exists(key))) {
    // Generation expired mid-scroll (or was never published): signal the
    // caller to restart on live Postgres instead of ending the feed early.
    return null;
  }

  const flat =
    exclusiveMaxScore === null
      ? await redis.zrevrange(key, 0, limit - 1, "WITHSCORES")
      : await redis.zrevrangebyscore(
          key,
          `(${exclusiveMaxScore}`,
          "-inf",
          "WITHSCORES",
          "LIMIT",
          0,
          limit
        );

  const entries: TrendingSnapshotEntry[] = [];
  for (let index = 0; index < flat.length; index += 2) {
    const member = flat[index];
    const score = flat[index + 1];
    if (typeof member === "string") {
      entries.push({ id: member, score: Number(score) });
    }
  }

  // A pinned generation that is empty means the window collapsed; fall back
  // rather than serving a permanently blank first page.
  if (entries.length === 0) {
    return null;
  }

  return {
    entries,
    generation,
    possiblyMore: flat.length >= limit,
  };
}
