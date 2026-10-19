import { createHash } from "node:crypto";

import { networkSql, rawQuery, redis } from "@asm/db";
import {
  BoundedReadQueue,
  SharedReadCache,
  createRedisReadStore,
} from "@asm/protocols/discovery";
import { z } from "zod";

const candidates = new SharedReadCache({
  deadlineMs: 5000,
  parse: (value) =>
    z
      .array(z.object({ id: z.string() }))
      .max(180)
      .parse(value),
  queue: new BoundedReadQueue({
    concurrency: 4,
    maxQueued: 128,
    maxWaitMs: 3000,
  }),
  store: createRedisReadStore(redis),
  ttlMs: 5000,
});

// Only candidate IDs are shared. Hydration must still apply current per-viewer visibility and feedback.
export async function nativeCandidateIds(options: {
  seeds: string[];
  explicit: boolean;
  mode: "personalized" | "trending" | "latest";
  gust: boolean;
  offset: number;
  anchor: string;
  continuation: boolean;
  signal: AbortSignal;
}) {
  const read = async () => {
    const result = await rawQuery<{ id: string }>(
      networkSql.pagedCandidates,
      [
        options.seeds,
        options.explicit,
        options.mode,
        options.gust,
        options.offset,
        options.anchor,
      ],
      { id: "pg/text@1" }
    );
    return result.rows;
  };
  if (options.continuation) {
    return { rows: await read() };
  }
  const key = `rec:native-candidates:v1:{${createHash("sha256")
    .update(
      JSON.stringify([
        [...options.seeds].toSorted(),
        options.explicit,
        options.mode,
        options.gust,
      ])
    )
    .digest("hex")}}`;
  return { rows: await candidates.read(key, read, options.signal) };
}
