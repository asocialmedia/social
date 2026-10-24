import { createHash } from "node:crypto";

import type { BlueskyClient } from "@asm/protocols/bluesky";
import { ProtocolError } from "@asm/protocols/contracts";
import {
  BoundedReadQueue,
  SharedReadCache,
  externalAuthorSchema,
  externalPostSchema,
} from "@asm/protocols/discovery";
import type { SharedReadStore } from "@asm/protocols/discovery";
import { z } from "zod";

type SearchClient = Partial<
  Pick<BlueskyClient, "searchActors" | "searchPosts">
>;
export type SearchKind = "all" | "user" | "post";

export function createBlueskySearch(options: {
  client: SearchClient;
  explicitClient?: SearchClient;
  store?: SharedReadStore;
  concurrency?: number;
  maxQueued?: number;
  maxWaitMs?: number;
}) {
  const queue = new BoundedReadQueue({
    concurrency: options.concurrency ?? 48,
    maxQueued: options.maxQueued ?? 512,
    maxWaitMs: options.maxWaitMs ?? 5000,
  });
  const profiles = new SharedReadCache({
    deadlineMs: 8500,
    parse: (value) => z.array(externalAuthorSchema).max(10).parse(value),
    queue,
    store: options.store,
    ttlMs: 30_000,
  });
  const posts = new SharedReadCache({
    deadlineMs: 8500,
    parse: (value) => z.array(externalPostSchema).max(10).parse(value),
    queue,
    store: options.store,
    ttlMs: 15_000,
  });
  return {
    close: () => {
      profiles.close();
      posts.close();
      queue.close();
    },
    read: async (
      query: string,
      limit: number,
      kind: SearchKind,
      explicit: boolean,
      signal: AbortSignal
    ) => {
      const client = explicit
        ? (options.explicitClient ?? options.client)
        : options.client;
      const key = (operation: string) =>
        `asm:search:bluesky:v1:{${createHash("sha256")
          .update(JSON.stringify([query.trim(), limit, operation, explicit]))
          .digest("hex")}}`;
      const [authors, results] = await Promise.allSettled([
        kind === "post"
          ? Promise.resolve([])
          : profiles.read(
              key("profiles"),
              () => {
                if (!client.searchActors) {
                  throw new ProtocolError(
                    "unavailable",
                    "Profile search unavailable"
                  );
                }
                return client.searchActors(query, limit);
              },
              signal
            ),
        kind === "user"
          ? Promise.resolve([])
          : posts.read(
              key("posts"),
              async () => {
                if (!client.searchPosts) {
                  throw new ProtocolError(
                    "unavailable",
                    "Post search unavailable"
                  );
                }
                const page = await client.searchPosts(query, "top", { limit });
                return page.items;
              },
              signal
            ),
      ]);
      const failures = [authors, results].flatMap((result) =>
        result.status === "rejected" ? [result.reason] : []
      );
      if (failures.length === (kind === "all" ? 2 : 1)) {
        const retryable = failures.find(
          (error) =>
            error instanceof ProtocolError &&
            ["capacity", "rate_limited", "cancelled"].includes(error.code)
        );
        throw (
          retryable ?? new ProtocolError("unavailable", "Search unavailable")
        );
      }
      return {
        posts: results.status === "fulfilled" ? results.value : [],
        profiles: authors.status === "fulfilled" ? authors.value : [],
        unavailable: [
          ...(authors.status === "rejected" ? ["profiles"] : []),
          ...(results.status === "rejected" ? ["posts"] : []),
        ],
      };
    },
    stats: () => ({
      ...queue.stats,
      posts: posts.stats,
      profiles: profiles.stats,
    }),
  };
}
