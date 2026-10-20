import { createHash } from "node:crypto";

import {
  BoundedReadQueue,
  externalAuthorSchema,
  externalPostSchema,
  SharedReadCache,
} from "@asm/protocols/discovery";
import type { SharedReadStore } from "@asm/protocols/discovery";
import { z } from "zod";

import type { readBlueskySearch } from "@/lib/protocols/service";

type SearchReader = typeof readBlueskySearch;

const resultSchema = z.object({
  posts: z.array(externalPostSchema).max(10),
  profiles: z.array(externalAuthorSchema).max(10),
  unavailable: z.array(z.enum(["profiles", "posts"])),
});

export function createSuggestionPublicSearch(
  store: SharedReadStore,
  read: SearchReader
) {
  const cache = new SharedReadCache({
    deadlineMs: 7000,
    parse: (value) => resultSchema.parse(value),
    queue: new BoundedReadQueue({
      concurrency: 8,
      maxQueued: 48,
      maxWaitMs: 5000,
    }),
    store,
    ttlMs: 30_000,
  });
  return (
    term: string,
    includeExplicit: boolean,
    signal: AbortSignal,
    requestId: string
  ) => {
    const normalized = term.trim().toLowerCase();
    const key = `rec:suggestion-public:v1:{${createHash("sha256")
      .update(JSON.stringify([normalized, includeExplicit]))
      .digest("hex")}}`;
    // Only public query results are shared; each viewer's graph, exclusions and ranking stay in the account snapshot.
    return cache.read(
      key,
      () =>
        read(
          normalized,
          AbortSignal.timeout(6000),
          requestId,
          "all",
          includeExplicit
        ),
      signal
    );
  };
}
