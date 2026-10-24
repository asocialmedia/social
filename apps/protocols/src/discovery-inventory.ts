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
  private readonly replenishing = new Map<string, Promise<DiscoveryPage>>();
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
    let sourceChain = `head:${Math.floor(Date.now() / 20_000)}`;
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
    const progressKey = `inventory-source:${scope}:${sourceChain}`;
    if (!sourceStarted || sourceCursor) {
      const completed =
        (await this.continuations.get(progressKey)) ??
        (await this.continuations.get(refillKey(sourceCursor)));
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
    const refill = () => {
      if (!this.readSource) {
        return;
      }
      const key = refillKey(sourceCursor);
      const existing = this.replenishing.get(key);
      if (existing) {
        return existing;
      }
      if (this.replenishing.size >= 8) {
        return;
      }
      const startedAt = Date.now();
      const position = sourceCursor;
      const owner = crypto.randomUUID();
      const chainKey = `inventory-refill-active:${scope}:${sourceChain}`;
      const { readSource } = this;
      const pending = (async () => {
        let claimed = false;
        let chainClaimed = false;
        try {
          claimed = await this.continuations.acquire(key, owner);
          if (!claimed) {
            throw new Error("Inventory refill is already running");
          }
          const completed = await this.continuations.get(key);
          if (completed) {
            const saved = continuationSchema.parse(JSON.parse(completed));
            if (saved.scope === scope) {
              const arrivals = await this.store.read();
              return {
                cursor: saved.sourceCursor ?? null,
                items: arrivals.filter(eligible).slice(0, 20),
                partial: false,
              };
            }
          }
          chainClaimed = await this.continuations.acquire(chainKey, owner);
          if (!chainClaimed) {
            throw new Error("Inventory source chain is already running");
          }
          const signal = AbortSignal.timeout(8000);
          let nextPosition = position;
          const latest = await this.continuations.get(progressKey);
          if (latest) {
            const progress = continuationSchema.parse(JSON.parse(latest));
            if (progress.scope === scope && progress.sourceStarted) {
              if (!progress.sourceCursor) {
                const currentArrivals = await this.store.read();
                return {
                  cursor: null,
                  items: currentArrivals.filter(eligible),
                  partial: false,
                };
              }
              nextPosition = progress.sourceCursor;
            }
          }
          const arrivals = new Map<string, ExternalPost>();
          for (let attempt = 0; attempt < 3; attempt += 1) {
            // oxlint-disable-next-line no-await-in-loop -- only the previous source page can supply the next cursor.
            const page = await abortable(
              readSource(mode, nextPosition, locale, topics, content),
              signal
            );
            // oxlint-disable-next-line no-await-in-loop -- persist validated arrivals before advancing the shared checkpoint.
            await this.store.put(page.items, startedAt);
            for (const post of page.items.filter(eligible)) {
              arrivals.set(post.id, post);
            }
            if (!page.partial || page.cursor) {
              const progress = JSON.stringify({
                scope,
                seen: [],
                sourceCursor: page.cursor ?? undefined,
                sourceStarted: true,
              });
              // oxlint-disable-next-line no-await-in-loop -- readers at other positions need the chain's most recent checkpoint.
              const chainSaved = await this.continuations.set(
                progressKey,
                progress,
                900_000,
                { key: chainKey, owner }
              );
              // oxlint-disable-next-line no-await-in-loop -- a later failure must preserve the last completed source page.
              const saved = await this.continuations.set(
                key,
                progress,
                900_000,
                { key, owner }
              );
              if (!saved || !chainSaved) {
                throw new Error("Inventory refill lost progress ownership");
              }
            }
            if (
              arrivals.size >= 20 ||
              !page.cursor ||
              page.cursor === nextPosition ||
              attempt === 2
            ) {
              return { ...page, items: [...arrivals.values()] };
            }
            nextPosition = page.cursor;
          }
          throw new Error("Inventory refill did not advance");
        } finally {
          try {
            if (claimed) {
              await this.continuations.release(key, owner);
            }
          } finally {
            try {
              if (chainClaimed) {
                await this.continuations.release(chainKey, owner);
              }
            } finally {
              this.replenishing.delete(key);
            }
          }
        }
      })();
      this.replenishing.set(key, pending);
      return pending;
    };
    // Replenish while at least a page remains, before the reader consumes the inventory.
    if (
      candidates.length > 0 &&
      candidates.length <= 40 &&
      this.readSource &&
      (!sourceStarted || sourceCursor)
    ) {
      partial = candidates.length < 20;
      // oxlint-disable-next-line promise/prefer-await-to-then -- sparse arrivals return while refill completion persists independently.
      void refill()?.catch(() => {
        // Keep the previous source position retryable after a failed refill.
      });
    }
    // A sparse local page must not hide deeper source pages from the reader.
    if (
      cursor &&
      candidates.length === 0 &&
      this.readSource &&
      (!sourceStarted || sourceCursor)
    ) {
      try {
        const pending = refill();
        if (!pending) {
          throw new Error("Inventory refill capacity unavailable");
        }
        const page = await abortable(
          pending,
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
        if (!page.partial || page.cursor) {
          sourceStarted = true;
          sourceCursor = page.cursor ?? undefined;
        }
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
