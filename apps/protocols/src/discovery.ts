// Coalesced cache misses share bounded discovery and upstream work.
// oxlint-disable promise/prefer-await-to-then, no-await-in-loop
import { createHash } from "node:crypto";

import type { BlueskyClient } from "@asm/protocols/bluesky";
import { ProtocolError } from "@asm/protocols/contracts";
import type { ExternalPost } from "@asm/protocols/contracts";
import {
  abortable,
  discoveryModeSchema,
  discoveryLocaleSchema,
  discoveryPageSchema,
  externalPostSchema,
  waitForReadRetry,
} from "@asm/protocols/discovery";
import type { DiscoveryMode, DiscoveryPage } from "@asm/protocols/discovery";
import { z } from "zod";

import {
  matchesDiscoveryLanguage,
  regionalRelevance,
} from "./discovery-relevance";
import { MemoryDiscoveryStore } from "./discovery-store";
import type { DiscoveryLease, DiscoveryStore } from "./discovery-store";

const snapshotSchema = z.object({
  locale: z.string().default(""),
  mode: discoveryModeSchema,
  page: z.number().int().min(0).max(20),
  seen: z.array(z.string().max(512)).max(400),
  sources: z
    .array(
      z.object({
        actor: z.string().max(2048),
        cursor: z.string().max(4096).optional(),
        exhausted: z.boolean(),
        items: z.array(externalPostSchema).max(50),
      })
    )
    .max(10),
});

type DiscoveryClient = Pick<
  BlueskyClient,
  "getProfile" | "getAuthorFeed" | "allowsRecommendations"
> &
  Partial<Pick<BlueskyClient, "getPosts" | "getFeed">>;

export const DEFAULT_DISCOVERY_SOURCES = [
  "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot",
];

async function mapBounded<Value, Result>(
  values: Value[],
  action: (value: Value) => Promise<Result>,
  concurrency = 3
): Promise<Result[]> {
  const results: Result[] = [];
  const entries = values.entries();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      for (let entry = entries.next(); !entry.done; entry = entries.next()) {
        const [index, value] = entry.value;
        results[index] = await action(value);
      }
    })
  );
  return results;
}

export class BlueskyDiscovery {
  private readonly pending = new Map<string, Promise<DiscoveryPage>>();
  private activeLoads = 0;
  private readonly client: DiscoveryClient;
  private readonly actors: string[];
  private readonly store: DiscoveryStore;
  private readonly scope: string;
  private readonly timeoutMs: number;
  constructor(
    client: DiscoveryClient,
    actors = DEFAULT_DISCOVERY_SOURCES,
    options: { store?: DiscoveryStore; timeoutMs?: number } = {}
  ) {
    if (
      actors.length === 0 ||
      actors.length > 10 ||
      new Set(actors).size !== actors.length
    ) {
      throw new RangeError("Discovery needs one to ten unique sources");
    }
    this.client = client;
    this.actors = [...actors];
    this.store = options.store ?? new MemoryDiscoveryStore();
    this.scope = createHash("sha256")
      .update(JSON.stringify(["diverse-v2", actors]))
      .digest("hex")
      .slice(0, 16);
    this.timeoutMs = options.timeoutMs ?? 12_000;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 60_000
    ) {
      throw new RangeError("Invalid discovery timeout");
    }
  }

  async read(
    mode: DiscoveryMode,
    cursor?: string,
    locale = ""
  ): Promise<DiscoveryPage> {
    if (
      !discoveryModeSchema.safeParse(mode).success ||
      (locale !== "" && !discoveryLocaleSchema.safeParse(locale).success) ||
      (cursor && !z.uuid().safeParse(cursor).success)
    ) {
      throw new ProtocolError("invalid_input", "Invalid discovery request");
    }
    const key = `${this.scope}:page:${locale}:${mode}:${cursor ?? "head"}`;
    const existing = this.pending.get(key);
    if (existing) {
      return discoveryPageSchema.parse(await existing);
    }
    if (this.pending.size >= 32) {
      throw new ProtocolError("capacity", "Discovery is busy", 2);
    }
    const signal = AbortSignal.timeout(this.timeoutMs);
    const request = this.readCached(mode, cursor, key, signal, locale);
    this.pending.set(key, request);
    try {
      return discoveryPageSchema.parse(await request);
    } catch (error) {
      if (error instanceof ProtocolError) {
        throw error;
      }
      throw new ProtocolError("unavailable", "Discovery is recovering", 2);
    } finally {
      this.pending.delete(key);
    }
  }

  private snapshotKey(cursor: string): string {
    return `${this.scope}:snapshot:${cursor}`;
  }

  private async cachedPage(
    key: string,
    signal: AbortSignal
  ): Promise<DiscoveryPage | null> {
    const cached = await abortable(this.store.get(key), signal);
    if (!cached) {
      return null;
    }
    let value: unknown;
    try {
      value = JSON.parse(cached);
    } catch {
      await this.store.set(key, "", 1);
      return null;
    }
    const parsed = discoveryPageSchema.safeParse(value);
    if (
      !parsed.success ||
      (parsed.data.cursor &&
        !(await abortable(
          this.store.get(this.snapshotKey(parsed.data.cursor)),
          signal
        )))
    ) {
      return null;
    }
    return parsed.data;
  }

  private async readCached(
    mode: DiscoveryMode,
    cursor: string | undefined,
    key: string,
    signal: AbortSignal,
    locale: string
  ): Promise<DiscoveryPage> {
    const cached = await this.cachedPage(key, signal);
    if (cached) {
      return cached;
    }
    if (
      cursor &&
      !(await abortable(this.store.get(this.snapshotKey(cursor)), signal))
    ) {
      throw new ProtocolError("invalid_input", "Discovery session expired");
    }
    const lease = { key, owner: crypto.randomUUID() };
    if (!(await abortable(this.store.acquire(key, lease.owner), signal))) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await waitForReadRetry(100, signal);
        const completed = await this.cachedPage(key, signal);
        if (completed) {
          return completed;
        }
      }
      throw new ProtocolError("capacity", "Discovery is being refreshed", 2);
    }
    try {
      // The lock may have been acquired immediately after another replica published its result.
      const completed = await this.cachedPage(key, signal);
      if (completed) {
        return completed;
      }
      if (this.activeLoads >= 2) {
        throw new ProtocolError("capacity", "Discovery is busy", 2);
      }
      this.activeLoads += 1;
      try {
        signal.throwIfAborted();
        const page = await this.load(mode, cursor, lease, signal, locale);
        if (
          !(await abortable(
            this.store.set(
              key,
              JSON.stringify(page),
              page.partial ? 1000 : 10_000,
              lease
            ),
            signal
          ))
        ) {
          throw new ProtocolError("capacity", "Discovery cache is full", 2);
        }
        return page;
      } finally {
        this.activeLoads -= 1;
      }
    } finally {
      try {
        await abortable(
          this.store.release(key, lease.owner),
          AbortSignal.timeout(2500)
        );
      } catch {
        // A failed release heals through the fenced lease expiry.
      }
    }
  }

  private async load(
    mode: DiscoveryMode,
    cursor: string | undefined,
    lease: DiscoveryLease,
    signal: AbortSignal,
    locale: string
  ): Promise<DiscoveryPage> {
    const stored = cursor
      ? await abortable(this.store.get(this.snapshotKey(cursor)), signal)
      : null;
    if (cursor && !stored) {
      throw new ProtocolError("invalid_input", "Discovery session expired");
    }
    let saved: z.infer<typeof snapshotSchema> | undefined;
    if (stored) {
      try {
        saved = snapshotSchema.parse(JSON.parse(stored));
      } catch {
        throw new ProtocolError(
          "invalid_input",
          "Discovery session needs refreshing"
        );
      }
    }
    const snapshot: z.infer<typeof snapshotSchema> = saved ?? {
      locale,
      mode,
      page: 0,
      seen: [],
      sources: this.actors.map((actor) => ({
        actor,
        cursor: undefined,
        exhausted: false,
        items: [],
      })),
    };
    if (snapshot.mode !== mode || snapshot.locale !== locale) {
      throw new ProtocolError(
        "invalid_input",
        "Discovery cursor belongs to another feed"
      );
    }
    let partial = false;
    let succeeded = 0;
    const blocked = new Set<string>();
    await mapBounded(snapshot.sources, async (source) => {
      if (source.exhausted && source.items.length === 0) {
        succeeded += 1;
        return;
      }
      try {
        if (source.items.length === 0) {
          const options = {
            cursor: source.cursor,
            language: locale && locale !== "all" ? locale : undefined,
            limit: 30,
          };
          const feed = source.actor.startsWith("at://");
          const profile = feed
            ? null
            : await abortable(this.client.getProfile(source.actor), signal);
          if (feed && !this.client.getFeed) {
            throw new ProtocolError(
              "unavailable",
              "Public feed reader is unavailable"
            );
          }
          const page = await abortable(
            feed && this.client.getFeed
              ? this.client.getFeed(source.actor, options)
              : this.client.getAuthorFeed(source.actor, "posts", options),
            signal
          );
          source.items = page.items.filter(
            (post) =>
              (!profile || post.author.id === profile.id) &&
              !snapshot.seen.includes(post.id) &&
              matchesDiscoveryLanguage(post, locale)
          );
          source.cursor = page.cursor ?? undefined;
          source.exhausted = !page.cursor;
        }
        succeeded += 1;
      } catch (error) {
        if (error instanceof ProtocolError && error.code === "restricted") {
          source.exhausted = true;
          source.items = [];
          succeeded += 1;
        } else {
          partial = true;
          blocked.add(source.actor);
        }
      }
    });
    // Public generators are algorithmic even when ASM displays their candidates by date.
    const authors = [
      ...new Set(
        snapshot.sources.flatMap((source) =>
          !blocked.has(source.actor) &&
          (mode !== "latest" || source.actor.startsWith("at://"))
            ? source.items.map((post) => post.author.id)
            : []
        )
      ),
    ];
    const allowed = new Set<string>();
    await mapBounded(
      authors,
      async (author) => {
        try {
          if (
            await abortable(this.client.allowsRecommendations(author), signal)
          ) {
            allowed.add(author);
          }
        } catch {
          partial = true;
        }
      },
      6
    );
    for (const source of snapshot.sources) {
      if (mode !== "latest" || source.actor.startsWith("at://")) {
        source.items = source.items.filter((post) =>
          allowed.has(post.author.id)
        );
      }
    }
    signal.throwIfAborted();
    if (succeeded === 0) {
      throw new ProtocolError(
        "unavailable",
        "Bluesky discovery is temporarily unavailable",
        2
      );
    }
    const items: ExternalPost[] = [];
    const authorCounts = new Map<string, number>();
    while (items.length < 20) {
      const candidates = snapshot.sources.flatMap((source) =>
        blocked.has(source.actor)
          ? []
          : source.items.map((post, index) => ({ index, post, source }))
      );
      let [selected] = candidates;
      for (const candidate of candidates) {
        const count = authorCounts.get(candidate.post.author.id) ?? 0;
        const selectedCount =
          authorCounts.get(selected?.post.author.id ?? "") ?? 0;
        if (
          count < selectedCount ||
          (count === selectedCount &&
            mode === "latest" &&
            Date.parse(candidate.post.createdAt) >
              Date.parse(selected?.post.createdAt ?? ""))
        ) {
          selected = candidate;
        }
      }
      const post = selected?.source.items.splice(selected.index, 1)[0];
      if (!post) {
        break;
      }
      if (!snapshot.seen.includes(post.id)) {
        items.push(post);
        snapshot.seen.push(post.id);
        authorCounts.set(
          post.author.id,
          (authorCounts.get(post.author.id) ?? 0) + 1
        );
      }
    }
    if (mode !== "latest" && locale) {
      items.sort(
        (first, second) =>
          regionalRelevance(second, locale) - regionalRelevance(first, locale)
      );
    }
    if (mode === "latest") {
      items.sort(
        (first, second) =>
          Date.parse(second.createdAt) - Date.parse(first.createdAt)
      );
    }
    snapshot.page += 1;
    const hasMore =
      snapshot.page < 20 &&
      snapshot.sources.some(
        (source) => source.items.length > 0 || !source.exhausted
      );
    let next: string | null = null;
    if (hasMore) {
      next = crypto.randomUUID();
      if (
        !(await abortable(
          this.store.set(
            this.snapshotKey(next),
            JSON.stringify(snapshot),
            900_000,
            lease
          ),
          signal
        ))
      ) {
        throw new ProtocolError("capacity", "Discovery cache is full", 2);
      }
    }
    // Continuation buffers can outlive a source edit or deletion; resolve selected records again.
    const current =
      cursor && this.client.getPosts && items.length > 0
        ? await abortable(
            this.client.getPosts(items.map((post) => post.id)),
            signal
          )
        : items;
    const byId = new Map(current.map((post) => [post.id, post]));
    return {
      cursor: next,
      items: items.flatMap((post) => {
        const latest = byId.get(post.id);
        return latest && matchesDiscoveryLanguage(latest, locale)
          ? [latest]
          : [];
      }),
      partial,
    };
  }
}
