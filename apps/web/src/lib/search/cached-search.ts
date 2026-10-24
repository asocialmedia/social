import { createHash } from "node:crypto";

import {
  redis,
  searchCommunitiesForSearch,
  searchPosts,
  searchUsers,
} from "@asm/db";
import {
  BoundedReadQueue,
  SharedReadCache,
  createRedisReadStore,
} from "@asm/protocols/discovery";
import { z } from "zod";

const publicRows = z.array(z.record(z.string(), z.unknown())).max(20);
const resultSchema = z.object({
  communities: publicRows,
  posts: publicRows,
  users: publicRows,
});
const queue = new BoundedReadQueue({
  concurrency: 8,
  maxQueued: 96,
  maxWaitMs: 1500,
});
const cache = new SharedReadCache({
  deadlineMs: 4000,
  parse: (value) => resultSchema.parse(value),
  queue,
  store: createRedisReadStore(redis),
  ttlMs: 15_000,
});

export function cachedSpotlightSearch(
  query: string,
  kind: "all" | "user" | "post" | "community",
  limit: number,
  signal: AbortSignal,
  excludeExplicit = true
) {
  const normalized = query.trim().toLowerCase();
  const key = `asm:search:native:v3:{${createHash("sha256")
    .update(JSON.stringify([normalized, kind, limit, excludeExplicit]))
    .digest("hex")}}`;
  return cache.read(
    key,
    async () => {
      const [users, posts, communities] = await Promise.all([
        kind === "all" || kind === "user"
          ? searchUsers(normalized, limit, excludeExplicit)
          : Promise.resolve([]),
        kind === "all" || kind === "post"
          ? searchPosts(normalized, limit, excludeExplicit)
          : Promise.resolve([]),
        kind === "all" || kind === "community"
          ? searchCommunitiesForSearch(normalized, limit, excludeExplicit)
          : Promise.resolve([]),
      ]);
      return resultSchema.parse({ communities, posts, users });
    },
    signal
  );
}
