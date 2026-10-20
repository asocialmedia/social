// Coalesced cache misses share bounded discovery and upstream work.
// oxlint-disable promise/prefer-await-to-then, no-await-in-loop
import { createHash } from "node:crypto";

import type { BlueskyClient } from "@asm/protocols/bluesky";
import { ProtocolError } from "@asm/protocols/contracts";
import type { ExternalPost } from "@asm/protocols/contracts";
import {
  abortable,
  discoveryContentSchema,
  discoveryModeSchema,
  discoveryLocaleSchema,
  discoveryPageSchema,
  discoveryTopicsSchema,
  externalPostSchema,
  externalTopicMatch,
  isAuthFeed,
  isAuthFeedUri,
  isAuthenticationNotice,
  isExternalTrendingPost,
  waitForReadRetry,
} from "@asm/protocols/discovery";
import type {
  DiscoveryContent,
  DiscoveryMode,
  DiscoveryPage,
} from "@asm/protocols/discovery";
import { z } from "zod";

import {
  matchesDiscoveryLanguage,
  discoveryRelevance,
  isFreshDiscoveryPost,
} from "./discovery-relevance";
import { MemoryDiscoveryStore } from "./discovery-store";
import type { DiscoveryLease, DiscoveryStore } from "./discovery-store";

const snapshotSchema = z.object({
  catalogCursor: z.string().max(4096).optional(),
  catalogExhausted: z.boolean().default(false),
  catalogFeeds: z.array(z.string().max(2048)).max(50).default([]),
  content: discoveryContentSchema.default("all"),
  locale: z.string().default(""),
  mode: discoveryModeSchema,
  page: z.number().int().min(0).max(1000),
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
  topics: discoveryTopicsSchema.default([]),
});

type DiscoveryClient = Pick<
  BlueskyClient,
  "getProfile" | "getAuthorFeed" | "allowsRecommendations"
> &
  Partial<
    Pick<
      BlueskyClient,
      "getPosts" | "getFeed" | "getSuggestedFeeds" | "searchPosts"
    >
  >;

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
  private readonly actors?: string[];
  private readonly store: DiscoveryStore;
  private readonly scope: string;
  private readonly timeoutMs: number;
  private readonly sourceTimeoutMs: number;
  constructor(
    client: DiscoveryClient,
    actors?: string[],
    options: {
      store?: DiscoveryStore;
      timeoutMs?: number;
      sourceTimeoutMs?: number;
    } = {}
  ) {
    if (
      actors &&
      (actors.length === 0 ||
        actors.length > 10 ||
        new Set(actors).size !== actors.length)
    ) {
      throw new RangeError("Discovery needs one to ten unique sources");
    }
    this.client = client;
    this.actors = actors ? [...actors] : undefined;
    this.store = options.store ?? new MemoryDiscoveryStore();
    this.scope = createHash("sha256")
      .update(JSON.stringify(["dynamic-v14", actors]))
      .digest("hex")
      .slice(0, 16);
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.sourceTimeoutMs = options.sourceTimeoutMs ?? 2500;
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
    locale = "",
    topics: string[] = [],
    content: DiscoveryContent = "all"
  ): Promise<DiscoveryPage> {
    if (
      !discoveryContentSchema.safeParse(content).success ||
      !discoveryModeSchema.safeParse(mode).success ||
      !discoveryTopicsSchema.safeParse(topics).success ||
      (locale !== "" && !discoveryLocaleSchema.safeParse(locale).success) ||
      (cursor && !z.uuid().safeParse(cursor).success)
    ) {
      throw new ProtocolError("invalid_input", "Invalid discovery request");
    }
    const key = `${this.scope}:page:${createHash("sha256")
      .update(JSON.stringify([locale, mode, topics, content]))
      .digest("hex")
      .slice(0, 24)}:${cursor ?? "head"}`;
    const existing = this.pending.get(key);
    if (existing) {
      return discoveryPageSchema.parse(await existing);
    }
    if (this.pending.size >= 32) {
      throw new ProtocolError("capacity", "Discovery is busy", 2);
    }
    const signal = AbortSignal.timeout(this.timeoutMs);
    const request = this.readCached(
      mode,
      cursor,
      key,
      signal,
      locale,
      topics,
      content
    );
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

  async refreshHead(
    mode: DiscoveryMode,
    locale: string,
    topics: string[],
    content: DiscoveryContent = "all"
  ) {
    const key = `${this.scope}:page:${createHash("sha256")
      .update(JSON.stringify([locale, mode, topics, content]))
      .digest("hex")
      .slice(0, 24)}:head`;
    const owner = crypto.randomUUID();
    const lease = { key, owner };
    if (this.activeLoads >= 4 || !(await this.store.acquire(key, owner))) {
      throw new ProtocolError("capacity", "Discovery is being refreshed", 2);
    }
    this.activeLoads += 1;
    try {
      const signal = AbortSignal.timeout(this.timeoutMs);
      // Keep the last usable head readable while its replacement is built.
      const page = await this.load(
        mode,
        undefined,
        lease,
        signal,
        locale,
        topics,
        content
      );
      if (
        !(await this.store.set(
          key,
          JSON.stringify(page),
          page.partial ? 5000 : 60_000,
          lease
        ))
      ) {
        throw new ProtocolError("capacity", "Discovery cache is full", 2);
      }
      return page;
    } finally {
      this.activeLoads -= 1;
      await this.store.release(key, owner);
    }
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
    locale: string,
    topics: string[],
    content: DiscoveryContent
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
      for (let attempt = 0; attempt < 100; attempt += 1) {
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
      // Cold scopes wait behind bounded active work instead of failing while another scope warms.
      for (
        let attempt = 0;
        this.activeLoads >= 8 && attempt < 100;
        attempt += 1
      ) {
        await waitForReadRetry(50, signal);
      }
      if (this.activeLoads >= 8) {
        throw new ProtocolError("capacity", "Discovery is busy", 2);
      }
      this.activeLoads += 1;
      try {
        signal.throwIfAborted();
        const page = await this.load(
          mode,
          cursor,
          lease,
          signal,
          locale,
          topics,
          content
        );
        let ttlMs = 60_000;
        if (page.partial) {
          ttlMs = 1000;
        } else if (cursor) {
          ttlMs = 30_000;
        }
        if (
          !(await abortable(
            this.store.set(key, JSON.stringify(page), ttlMs, lease),
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
    locale: string,
    topics: string[],
    content: DiscoveryContent
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
      catalogCursor: undefined,
      catalogExhausted: false,
      catalogFeeds: [],
      content,
      locale,
      mode,
      page: 0,
      seen: [],
      sources: (this.actors ?? []).map((actor) => ({
        actor,
        cursor: undefined,
        exhausted: false,
        items: [],
      })),
      topics,
    };
    if (
      snapshot.content !== content ||
      snapshot.mode !== mode ||
      snapshot.locale !== locale ||
      JSON.stringify(snapshot.topics) !== JSON.stringify(topics)
    ) {
      throw new ProtocolError(
        "invalid_input",
        "Discovery cursor belongs to another feed"
      );
    }
    // Focused profiles search their topics directly instead of waiting for unrelated catalog generators.
    if (!saved && !this.actors && topics.length && this.client.searchPosts) {
      snapshot.sources = [...new Set([topics[0], topics[1], topics.at(-1)])]
        .filter((topic): topic is string => Boolean(topic))
        .map((topic) => ({
          actor: `search:${topic}`,
          cursor: undefined,
          exhausted: false,
          items: [],
        }));
    }
    // Resolve sources from the live public catalog, then page that catalog as sources run out.
    if (
      !this.actors &&
      this.client.getSuggestedFeeds &&
      !snapshot.catalogExhausted &&
      snapshot.catalogFeeds.length === 0 &&
      (snapshot.sources.length === 0 ||
        snapshot.sources.every(
          (source) => source.exhausted && source.items.length === 0
        ))
    ) {
      const catalog = await abortable(
        this.client.getSuggestedFeeds({
          cursor: snapshot.catalogCursor,
          limit: 24,
          ...(content === "video" ? { query: "video" } : {}),
        }),
        signal
      );
      snapshot.catalogCursor = catalog.cursor ?? undefined;
      snapshot.catalogExhausted = !catalog.cursor;
      const offset =
        (Math.floor(Date.now() / 300_000) + (mode === "latest" ? 0 : 7)) %
        Math.max(1, catalog.items.length);
      const rotated = [
        ...catalog.items.slice(offset),
        ...catalog.items.slice(0, offset),
      ];
      const findFeeds = this.client.getSuggestedFeeds.bind(this.client);
      const related = await mapBounded(topics.slice(0, 3), async (topic) => {
        try {
          const result = await abortable(
            findFeeds({ limit: 5, query: topic }),
            signal
          );
          return result.items;
        } catch {
          return [];
        }
      });
      const feeds = [
        ...new Map(
          [
            ...related.flatMap((matches) =>
              matches.slice(0, content === "video" ? 2 : 1)
            ),
            ...rotated,
          ].map((feed) => [feed.uri, feed])
        ).values(),
      ].filter((feed) => !isAuthFeed(feed));
      if (content === "video") {
        feeds.sort(
          (a, b) =>
            Number(b.contentMode === "app.bsky.feed.defs#contentModeVideo") -
              Number(a.contentMode === "app.bsky.feed.defs#contentModeVideo") ||
            (b.likeCount ?? 0) - (a.likeCount ?? 0)
        );
      }
      snapshot.catalogFeeds = feeds.slice(4).map((feed) => feed.uri);
      snapshot.sources = feeds.slice(0, 4).map((feed) => ({
        actor: feed.uri,
        cursor: undefined,
        exhausted: false,
        items: [],
      }));
      if (this.client.searchPosts) {
        snapshot.sources.unshift(
          ...[
            ...new Set([
              topics[0],
              topics.length > 1
                ? topics[
                    1 +
                      (Math.floor(Date.now() / 300_000) %
                        Math.max(1, topics.length - 1))
                  ]
                : undefined,
              topics.at(-1),
            ]),
          ]
            .filter((topic): topic is string => Boolean(topic))
            .map((topic) => ({
              actor: `search:${topic}`,
              cursor: undefined,
              exhausted: false,
              items: [],
            }))
        );
      }
    }
    if (
      !this.actors &&
      snapshot.catalogFeeds.length > 0 &&
      snapshot.sources.every(
        (source) => source.exhausted && source.items.length === 0
      )
    ) {
      snapshot.sources = snapshot.catalogFeeds.splice(0, 4).map((actor) => ({
        actor,
        cursor: undefined,
        exhausted: false,
        items: [],
      }));
    }
    if (snapshot.sources.length === 0) {
      throw new ProtocolError(
        "unavailable",
        "No public discovery sources available"
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
        const sourceSignal = AbortSignal.any([
          signal,
          AbortSignal.timeout(this.sourceTimeoutMs),
        ]);
        for (
          let attempt = 0;
          source.items.length === 0 &&
          !source.exhausted &&
          attempt < (content === "video" || mode === "trending" ? 3 : 1);
          attempt += 1
        ) {
          const options = {
            cursor: source.cursor,
            language: locale && locale !== "all" ? locale : undefined,
            limit: this.actors ? 30 : 16,
            since: new Date(
              Math.floor(Date.now() / 60_000) * 60_000 -
                (mode === "trending" ? 2 : 7) * 86_400_000
            ).toISOString(),
          };
          if (content === "video" || mode === "trending") {
            options.limit = 50;
          }
          const search = source.actor.startsWith("search:");
          const feed = source.actor.startsWith("at://") || search;
          if (feed && isAuthFeedUri(source.actor)) {
            blocked.add(source.actor);
            source.exhausted = true;
            source.items = [];
            succeeded += 1;
            return;
          }
          const profile = feed
            ? null
            : await abortable(
                this.client.getProfile(source.actor),
                sourceSignal
              );
          if (feed && !search && !this.client.getFeed) {
            throw new ProtocolError(
              "unavailable",
              "Public feed reader is unavailable"
            );
          }
          let read;
          if (search && this.client.searchPosts) {
            read = this.client.searchPosts(
              source.actor.slice(7),
              mode !== "latest" || content === "video" ? "top" : "latest",
              options
            );
          } else if (feed && this.client.getFeed) {
            read = this.client.getFeed(source.actor, options);
          } else {
            read = this.client.getAuthorFeed(source.actor, "posts", options);
          }
          const page = await abortable(read, sourceSignal);
          source.items = page.items.filter(
            (post) =>
              isFreshDiscoveryPost(post, mode) &&
              (content !== "video" ||
                post.media.some((media) => media.type === "video")) &&
              (!profile || post.author.id === profile.id) &&
              !snapshot.seen.includes(post.id) &&
              ((mode !== "trending" && topics.length > 0) ||
                isExternalTrendingPost(post)) &&
              !isAuthenticationNotice(post.text) &&
              matchesDiscoveryLanguage(post, locale) &&
              (!topics.length ||
                topics.some((topic) => externalTopicMatch(post, topic) > 0))
          );
          source.cursor = page.cursor ?? undefined;
          source.exhausted = !page.cursor;
        }
        succeeded += 1;
      } catch (error) {
        if (error instanceof ProtocolError && error.code === "restricted") {
          blocked.add(source.actor);
          source.exhausted = true;
          source.items = [];
          succeeded += 1;
        } else {
          partial = true;
          blocked.add(source.actor);
        }
      }
    });
    signal.throwIfAborted();
    if (succeeded === 0) {
      throw new ProtocolError(
        "unavailable",
        "Bluesky discovery is temporarily unavailable",
        2
      );
    }
    const directAuthors = new Set(
      snapshot.sources
        .filter(
          (source) =>
            !source.actor.startsWith("at://") &&
            !source.actor.startsWith("search:")
        )
        .flatMap((source) => source.items.map((post) => post.author.id))
    );
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
          !selected ||
          count < selectedCount ||
          (count === selectedCount &&
            mode === "latest" &&
            Date.parse(candidate.post.createdAt) >
              Date.parse(selected?.post.createdAt ?? "")) ||
          (count === selectedCount &&
            mode !== "latest" &&
            discoveryRelevance(candidate.post, topics, locale, mode) >
              discoveryRelevance(selected.post, topics, locale, mode))
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
    // Check the selected page, not hundreds of candidates that will not be displayed.
    // Unconsumed buffers are checked when their own page is selected.
    const needsPolicy = (post: ExternalPost) =>
      mode !== "latest" || !directAuthors.has(post.author.id);
    // Six concurrent policy reads is a deliberate bound on the public AppView.
    // These calls dominate a cold page, so their results are shared through
    // Redis (see createCachedBlueskyClient) rather than made faster by raising
    // concurrency against an upstream we do not control.
    const allowed = new Set<string>();
    await mapBounded(
      [...new Set(items.filter(needsPolicy).map((post) => post.author.id))],
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
    const permitted = items.filter(
      (post) => !needsPolicy(post) || allowed.has(post.author.id)
    );
    if (mode === "latest") {
      items.sort(
        (first, second) =>
          Date.parse(second.createdAt) - Date.parse(first.createdAt)
      );
    }
    snapshot.seen = snapshot.seen.slice(-400);
    snapshot.page += 1;
    const hasMore =
      snapshot.page < 1000 &&
      ((!this.actors &&
        (!snapshot.catalogExhausted || snapshot.catalogFeeds.length > 0)) ||
        snapshot.sources.some(
          (source) => source.items.length > 0 || !source.exhausted
        ));
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
      cursor && this.client.getPosts && permitted.length > 0
        ? await abortable(
            this.client.getPosts(permitted.map((post) => post.id)),
            signal
          )
        : permitted;
    const byId = new Map(current.map((post) => [post.id, post]));
    return {
      cursor: next,
      items: permitted.flatMap((post) => {
        const latest = byId.get(post.id);
        return latest &&
          isFreshDiscoveryPost(latest, mode) &&
          ((mode !== "trending" && topics.length > 0) ||
            isExternalTrendingPost(latest)) &&
          (content !== "video" ||
            latest.media.some((media) => media.type === "video")) &&
          matchesDiscoveryLanguage(latest, locale)
          ? [latest]
          : [];
      }),
      partial,
    };
  }
}
