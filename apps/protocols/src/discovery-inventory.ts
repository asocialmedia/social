import { createHash } from "node:crypto";

import type { ExternalPost } from "@asm/protocols/contracts";
import { createExternalTopicMatcher } from "@asm/protocols/contracts";
import {
  abortable,
  blueskyMediaIsExplicit,
  hasRestrictedDiscoveryLabels,
  isExternalTrendingPost,
} from "@asm/protocols/discovery";
import type {
  DiscoveryContent,
  DiscoveryMode,
  DiscoveryPage,
} from "@asm/protocols/discovery";
import { z } from "zod";

import type { InventoryStore } from "./discovery-inventory-store";
import {
  discoveryRelevance,
  matchesDiscoveryLanguage,
  isFreshDiscoveryPost,
} from "./discovery-relevance";
import type { DiscoveryStore } from "./discovery-store";

export { RedisInventoryStore } from "./discovery-inventory-store";
export type { InventoryStore } from "./discovery-inventory-store";

const continuationSchema = z.object({
  scope: z.string(),
  seen: z.array(z.string().max(2300)).max(2000),
  sourceChain: z.string().optional(),
  sourceCursor: z.string().optional(),
  sourceStarted: z.boolean().default(false),
});

type ReadSource = (
  mode: DiscoveryMode,
  cursor: string | undefined,
  locale: string,
  topics: string[],
  content: DiscoveryContent
) => Promise<DiscoveryPage>;

export class DiscoveryInventory {
  private readonly store: InventoryStore;
  private readonly continuations: DiscoveryStore;
  private readonly readSource?: ReadSource;
  private readonly allowExplicit: boolean;
  private readonly sourceTimeoutMs: number;
  private readonly replenishing = new Set<string>();
  constructor(
    store: InventoryStore,
    continuations: DiscoveryStore,
    readSource?: ReadSource,
    allowExplicit = false,
    sourceTimeoutMs = 1000
  ) {
    this.store = store;
    this.continuations = continuations;
    this.readSource = readSource;
    this.allowExplicit = allowExplicit;
    this.sourceTimeoutMs = sourceTimeoutMs;
  }

  async read(
    mode: DiscoveryMode,
    cursor: string | undefined,
    locale: string,
    topics: string[],
    content: DiscoveryContent
  ): Promise<DiscoveryPage | null> {
    const scope = createHash("sha256")
      .update(
        JSON.stringify([mode, locale, topics, content, this.allowExplicit])
      )
      .digest("hex");
    let seen: string[] = [];
    let sourceCursor: string | undefined;
    let sourceStarted = false;
    let sourceChain: string = crypto.randomUUID();
    if (cursor) {
      const raw = await this.continuations.get(`inventory:${cursor}`);
      if (!raw) {
        return null;
      }
      const saved = continuationSchema.parse(JSON.parse(raw));
      if (saved.scope !== scope) {
        return null;
      }
      ({ seen, sourceCursor, sourceStarted } = saved);
      sourceChain = saved.sourceChain ?? cursor;
    }
    const refillKey = (position: string | undefined) =>
      `inventory-refill:${scope}:${sourceChain}:${position ?? "head"}`;
    if (cursor && (!sourceStarted || sourceCursor)) {
      const completed = await this.continuations.get(refillKey(sourceCursor));
      if (completed) {
        const saved = continuationSchema.parse(JSON.parse(completed));
        if (saved.scope === scope) {
          ({ sourceCursor, sourceStarted } = saved);
        }
      }
    }
    const now = Date.now();
    const known = new Set(seen);
    const posts = await this.store.read();
    const eligible = (post: ExternalPost) => {
      if (
        known.has(post.id) ||
        (!this.allowExplicit && blueskyMediaIsExplicit(post)) ||
        hasRestrictedDiscoveryLabels(post)
      ) {
        return false;
      }
      if (!isFreshDiscoveryPost(post, mode, now)) {
        return false;
      }
      if (
        content === "video" &&
        !post.media.some((media) => media.type === "video")
      ) {
        return false;
      }
      if (
        (mode === "trending" || !topics.length) &&
        !isExternalTrendingPost(post)
      ) {
        return false;
      }
      if (!matchesDiscoveryLanguage(post, locale)) {
        return false;
      }
      const match = createExternalTopicMatcher(post);
      return !topics.length || topics.some((topic) => match(topic) > 0);
    };
    let candidates = posts.filter(eligible);
    let partial = false;
    // Deliver verified arrivals immediately; a sparse page must not wait on a broken generator.
    if (
      cursor &&
      candidates.length > 0 &&
      candidates.length < 20 &&
      this.readSource &&
      (!sourceStarted || sourceCursor)
    ) {
      partial = true;
      const key = `${scope}:${sourceCursor ?? "head"}`;
      const { readSource } = this;
      if (!this.replenishing.has(key) && this.replenishing.size < 8) {
        this.replenishing.add(key);
        const startedAt = Date.now();
        const position = sourceCursor;
        void (async () => {
          try {
            const page = await readSource(
              mode,
              position,
              locale,
              topics,
              content
            );
            await this.store.put(page.items, startedAt);
            await this.continuations.set(
              refillKey(position),
              JSON.stringify({
                scope,
                seen: [],
                sourceCursor: page.cursor ?? undefined,
                sourceStarted: true,
              }),
              900_000
            );
          } catch {
            // A failed background refill leaves existing verified arrivals and the cursor usable.
          } finally {
            this.replenishing.delete(key);
          }
        })();
      }
    }
    // A sparse local page must not hide deeper source pages from the reader.
    if (
      cursor &&
      candidates.length === 0 &&
      this.readSource &&
      (!sourceStarted || sourceCursor)
    ) {
      try {
        const page = await abortable(
          this.readSource(mode, sourceCursor, locale, topics, content),
          AbortSignal.timeout(this.sourceTimeoutMs)
        );
        candidates = [
          ...new Map(
            [...candidates, ...page.items.filter(eligible)].map((post) => [
              post.id,
              post,
            ])
          ).values(),
        ];
        sourceStarted = true;
        sourceCursor = page.cursor ?? undefined;
        ({ partial } = page);
      } catch {
        // Keep the last source position retryable and serve validated local arrivals.
        partial = true;
      }
    }
    if (!candidates.length && !cursor) {
      return null;
    }
    // New arrivals replenish a continuation without recycling its previously consumed IDs.
    const ranked = candidates
      .map((post) => ({
        post,
        score:
          mode === "latest"
            ? Date.parse(post.createdAt)
            : discoveryRelevance(post, topics, locale, mode),
      }))
      .toSorted((a, b) => b.score - a.score);
    const selected: ExternalPost[] = [];
    const authors = new Map<string, number>();
    while (ranked.length && selected.length < 20) {
      const index =
        cursor || mode === "latest"
          ? 0
          : ranked.findIndex(
              ({ post }) => (authors.get(post.author.id) ?? 0) < 2
            );
      const [item] = ranked.splice(Math.max(0, index), 1);
      if (!item) {
        break;
      }
      selected.push(item.post);
      authors.set(
        item.post.author.id,
        (authors.get(item.post.author.id) ?? 0) + 1
      );
    }
    let next: string | null = null;
    if (
      ranked.length ||
      selected.length === 20 ||
      (this.readSource && (!sourceStarted || sourceCursor))
    ) {
      next = crypto.randomUUID();
      const saved = await this.continuations.set(
        `inventory:${next}`,
        JSON.stringify({
          scope,
          seen: [...seen, ...selected.map((post) => post.id)].slice(-2000),
          sourceChain,
          sourceCursor,
          sourceStarted,
        }),
        900_000
      );
      if (!saved) {
        next = null;
      }
    }
    return { cursor: next, items: selected, partial };
  }
}
