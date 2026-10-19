// oxlint-disable no-await-in-loop -- merge heads must be replenished before choosing the next chronological item.
import { createHash } from "node:crypto";

import { externalFollowAuthors } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import {
  externalPostSchema,
  discoveryPageSchema,
} from "@asm/protocols/discovery";
import { z } from "zod";

import { followingStore } from "./following-store";
import { ProtocolGatewayError } from "./gateway";
import { readBlueskyProfileResource } from "./service";

const sourceSchema = z.object({
  cursor: z.string().nullable(),
  did: z.string(),
  exhausted: z.boolean(),
  pending: z.array(externalPostSchema).max(5),
  started: z.boolean(),
});
const stateSchema = z.object({
  membership: z.string(),
  seen: z.array(z.string()).max(2000),
  sources: z.array(sourceSchema).max(100),
});
type FollowingState = z.infer<typeof stateSchema>;

export async function mergeFollowingPage(
  state: FollowingState,
  read: (
    did: string,
    cursor: string | null
  ) => Promise<{ items: ExternalPost[]; cursor: string | null }>,
  limit = 25
) {
  const failed = new Set<string>();
  const seen = new Set(state.seen);
  let partial = false;
  const refill = async (source: FollowingState["sources"][number]) => {
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const page = await read(source.did, source.cursor);
        source.started = true;
        source.cursor = page.cursor;
        source.exhausted = !page.cursor;
        // Author feeds can contain pinned posts and reposts of other accounts.
        source.pending = page.items
          .filter(
            (post) =>
              post.author.id === source.did &&
              !seen.has(post.id) &&
              Date.parse(post.createdAt) <= Date.now() + 60_000
          )
          .toSorted(
            (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
          );
        if (source.pending.length || source.exhausted) {
          return;
        }
      }
      partial = true;
    } catch {
      failed.add(source.did);
      partial = true;
    }
  };
  const empty = state.sources.filter(
    (source) => !source.pending.length && !source.exhausted
  );
  // Bound fan-out; a viewer cannot generate an unbounded upstream burst.
  for (let offset = 0; offset < empty.length; offset += 8) {
    await Promise.all(empty.slice(offset, offset + 8).map(refill));
  }
  const items: ExternalPost[] = [];
  let refills = 0;
  while (items.length < limit) {
    const [next] = state.sources
      .filter((source) => source.pending.length)
      .toSorted(
        (a, b) =>
          Date.parse(b.pending[0]?.createdAt ?? "") -
          Date.parse(a.pending[0]?.createdAt ?? "")
      );
    if (!next) {
      break;
    }
    const post = next.pending.shift();
    if (post && !seen.has(post.id)) {
      items.push(post);
      seen.add(post.id);
    }
    if (!next.pending.length && !next.exhausted && !failed.has(next.did)) {
      if (refills >= 10) {
        partial = true;
        break;
      }
      refills += 1;
      await refill(next);
    }
  }
  state.seen = [...seen].slice(-2000);
  if (
    failed.size === state.sources.length &&
    state.sources.length &&
    !items.length
  ) {
    throw new ProtocolGatewayError(503, "following_unavailable");
  }
  return {
    hasMore: state.sources.some(
      (source) => source.pending.length || !source.exhausted
    ),
    items,
    partial,
  };
}

export async function readFollowingFeed(
  userId: string,
  cursor: string | undefined,
  signal: AbortSignal,
  requestId: string,
  policy = "default",
  refresh = false,
  includeExplicit = false,
  cachedOnly = false
) {
  const followedAuthors = await externalFollowAuthors(userId);
  const authors = followedAuthors.filter(
    (author) => author.status === "active"
  );
  const membership = createHash("sha256")
    .update(
      JSON.stringify([
        policy,
        includeExplicit,
        authors.map((author) => [author.did, author.followedAt]),
      ])
    )
    .digest("hex");
  const owner = createHash("sha256").update(userId).digest("hex");
  const headKey = `asm:protocols:following:${owner}:head:${membership}`;
  if (!cursor && !refresh) {
    const rawHead = await followingStore.get(headKey);
    const cached = rawHead
      ? discoveryPageSchema.safeParse(JSON.parse(rawHead))
      : null;
    if (cached?.success) {
      return cached.data;
    }
  }
  if (cachedOnly) {
    return { cursor: null, items: [] as ExternalPost[], partial: true };
  }
  const leaseKey = `build:${owner}`;
  const leaseOwner = crypto.randomUUID();
  if (!(await followingStore.acquire(leaseKey, leaseOwner))) {
    throw new ProtocolGatewayError(503, "following_busy");
  }
  try {
    let state: FollowingState;
    if (cursor) {
      if (!z.uuid().safeParse(cursor).success) {
        throw new ProtocolGatewayError(400, "invalid_cursor");
      }
      const raw = await followingStore.get(
        `asm:protocols:following:${owner}:${cursor}`
      );
      const parsed = raw ? stateSchema.safeParse(JSON.parse(raw)) : null;
      if (!parsed?.success || parsed.data.membership !== membership) {
        throw new ProtocolGatewayError(410, "expired_cursor");
      }
      state = parsed.data;
    } else {
      state = {
        membership,
        seen: [],
        sources: authors.map((author) => ({
          cursor: null,
          did: author.did,
          exhausted: false,
          pending: [],
          started: false,
        })),
      };
    }
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(14_000)]);
    const result = await mergeFollowingPage(
      state,
      async (did, sourceCursor) => {
        const params = new URLSearchParams({
          actor: did,
          limit: "5",
          pins: "0",
          tab: "posts",
        });
        if (sourceCursor) {
          params.set("cursor", sourceCursor);
        }
        const page = await readBlueskyProfileResource(
          "author-feed",
          params,
          bounded,
          requestId,
          includeExplicit
        );
        if (!("items" in page)) {
          throw new ProtocolGatewayError(503, "invalid_author_feed");
        }
        return page;
      }
    );
    const next = result.hasMore ? crypto.randomUUID() : null;
    if (next) {
      const serialized = JSON.stringify(state);
      if (Buffer.byteLength(serialized) > 8 * 1024 * 1024) {
        throw new ProtocolGatewayError(503, "following_page_too_large");
      }
      const saved = await followingStore.set(
        `asm:protocols:following:${owner}:${next}`,
        serialized,
        300_000,
        { key: leaseKey, owner: leaseOwner }
      );
      if (!saved) {
        throw new ProtocolGatewayError(503, "following_cache_full");
      }
    }
    // A concurrent unfollow, deletion, or suspension must not leak a saved continuation.
    const currentAuthors = await externalFollowAuthors(userId);
    const current = new Set(
      currentAuthors
        .filter((author) => author.status === "active")
        .map((author) => author.did)
    );
    const page = {
      cursor: next,
      items: result.items.filter((post) => current.has(post.author.id)),
      partial: result.partial,
    };
    if (!cursor) {
      await followingStore.set(
        headKey,
        JSON.stringify(page),
        result.partial ? 3000 : 10_000,
        { key: leaseKey, owner: leaseOwner }
      );
    }
    return page;
  } finally {
    await followingStore.release(leaseKey, leaseOwner).catch(() => null);
  }
}
