import { createHash } from "node:crypto";

import IoRedis from "ioredis";
import type { RedisOptions } from "ioredis";
import type { JSONWebKeySet } from "jose";

import { keys } from "../keys";
import { createRedisConnectionOptions } from "./redis-options";

const createRedisConfig = (): RedisOptions => {
  const config: RedisOptions = {
    autoResendUnfulfilledCommands: true,
    commandTimeout: 3000,
    connectTimeout: 5000,
    enableReadyCheck: true,
    keepAlive: 10_000,
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    reconnectOnError: (err) => {
      const targetError = "READONLY";
      if (err.message.includes(targetError)) {
        return true;
      }
      return false;
    },
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 1000);
      return delay;
    },
    showFriendlyErrorStack: true,
  };

  return config;
};

let redisClient: IoRedis | null = null;

const getRedisClient = (): IoRedis => {
  if (redisClient && redisClient.status !== "end") {
    return redisClient;
  }

  if (redisClient?.status === "end") {
    redisClient = null;
  }

  const redisUrl = process.env.REDIS_URL ?? keys.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is not configured");
  }

  redisClient = new IoRedis(
    createRedisConnectionOptions(redisUrl, createRedisConfig())
  );

  return redisClient;
};

// Direct access to the shared client for consumers that need to hand the
// connection itself to another module (e.g. the auth service's security
// store). Most code should use the `redis` proxy above instead.
export { getRedisClient };

const redis = new Proxy({} as IoRedis, {
  get(_target, property) {
    const client = getRedisClient();
    const value = Reflect.get(client, property, client);

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  },
});

export { redis };

// A dedicated ioredis connection for blocking commands (XREADGROUP with BLOCK,
// XADD waiting, etc.). The shared client sets a commandTimeout, which would
// kill long-blocking reads; this connection disables it so a BLOCK 2000 read
// can wait as long as the stream stays idle.
let blockingClient: IoRedis | null = null;

export function getBlockingRedisClient(): IoRedis {
  if (blockingClient && blockingClient.status !== "end") {
    return blockingClient;
  }

  if (blockingClient?.status === "end") {
    blockingClient = null;
  }

  const redisUrl = process.env.REDIS_URL ?? keys.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is not configured");
  }

  blockingClient = new IoRedis(
    createRedisConnectionOptions(redisUrl, {
      ...createRedisConfig(),
      commandTimeout: undefined,
      maxRetriesPerRequest: null,
    })
  );

  return blockingClient;
}

// A long-lived pub/sub connection for SSE fan-out. Like the blocking client,
// it drops the commandTimeout and maxRetriesPerRequest so a subscriber that
// sits idle (or reconnects mid-subscription) is never killed by a timeout.
// Created lazily per stream and `quit()` when the stream closes.
export function createSubscriberConnection(): IoRedis {
  const redisUrl = process.env.REDIS_URL ?? keys.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is not configured");
  }

  return new IoRedis(
    createRedisConnectionOptions(redisUrl, {
      ...createRedisConfig(),
      commandTimeout: undefined,
      maxRetriesPerRequest: null,
    })
  );
}

// ---- shared pub/sub hub ----------------------------------------------------
// One long-lived subscriber connection is shared by every SSE stream in the
// process instead of a separate connection per open stream (which, with many
// viewers, burns a Redis connection and its file descriptor each). Streams
// subscribe to a channel and get back an unsubscribe function; the hub
// reference-counts channels so a channel is only unsubscribed (and its slots
// freed) when the last stream leaves it. ioredis re-subscribes automatically
// across reconnects, so only the in-memory listener map needs managing here.
export type ChannelListener = (channel: string, message: string) => void;

export interface ChannelSubscription {
  unsubscribe: () => Promise<void>;
}

let hubClient: IoRedis | null = null;
const hubListeners = new Map<string, Set<ChannelListener>>();
let hubOpenStreams = 0;

// Gauges for observability: how many streams are open and how many distinct
// channels/listeners the shared connection is carrying right now.
export function getSubscriberGauges(): {
  activeChannels: number;
  activeListeners: number;
  openStreams: number;
} {
  let activeListeners = 0;
  for (const listeners of hubListeners.values()) {
    activeListeners += listeners.size;
  }
  return {
    activeChannels: hubListeners.size,
    activeListeners,
    openStreams: hubOpenStreams,
  };
}

// A quiet periodic log of the hub gauges so connection usage is observable in
// the web app's logs without a dedicated metrics endpoint. Only logs while
// streams are actually open; goes silent when the last stream closes.
let gaugeTimer: ReturnType<typeof setInterval> | null = null;

function ensureGaugeLogging(): void {
  if (gaugeTimer) {
    return;
  }
  gaugeTimer = setInterval(() => {
    const gauges = getSubscriberGauges();
    if (gauges.openStreams > 0) {
      console.log(
        `[pubsub-hub] openStreams=${gauges.openStreams} ` +
          `activeChannels=${gauges.activeChannels} ` +
          `activeListeners=${gauges.activeListeners}`
      );
    }
  }, 60_000);
}

function stopGaugeLoggingWhenIdle(): void {
  if (gaugeTimer && hubOpenStreams === 0 && hubListeners.size === 0) {
    clearInterval(gaugeTimer);
    gaugeTimer = null;
  }
}

function getHubClient(): IoRedis {
  if (!hubClient || hubClient.status === "end") {
    if (hubClient?.status === "end") {
      hubClient = null;
    }
    hubClient = createSubscriberConnection();
    hubClient.on("message", (channel, message) => {
      const listeners = hubListeners.get(channel);
      if (!listeners) {
        return;
      }
      for (const listener of listeners) {
        try {
          listener(channel, message);
        } catch (error) {
          console.error("Subscriber listener threw:", error);
        }
      }
    });
  }
  return hubClient;
}

// Subscribes `listener` to `channel`. The first stream on a channel triggers
// the real Redis SUBSCRIBE; subsequent streams on the same channel reuse it.
export async function subscribeToChannel(
  channel: string,
  listener: ChannelListener
): Promise<ChannelSubscription> {
  const client = getHubClient();
  const listeners = hubListeners.get(channel) ?? new Set<ChannelListener>();
  const isFirst = listeners.size === 0;
  listeners.add(listener);
  hubListeners.set(channel, listeners);
  hubOpenStreams += 1;
  ensureGaugeLogging();

  if (isFirst) {
    try {
      await client.subscribe(channel);
    } catch (error) {
      // Roll back so a failed subscribe does not strand a phantom listener.
      listeners.delete(listener);
      if (listeners.size === 0) {
        hubListeners.delete(channel);
      }
      hubOpenStreams -= 1;
      throw error;
    }
  }

  let unsubscribed = false;
  return {
    unsubscribe: async () => {
      if (unsubscribed) {
        return;
      }
      unsubscribed = true;
      hubOpenStreams -= 1;
      const current = hubListeners.get(channel);
      if (!current) {
        return;
      }
      current.delete(listener);
      if (current.size === 0) {
        hubListeners.delete(channel);
        try {
          await client.unsubscribe(channel);
        } catch {
          // Non-fatal: the connection may be gone, and ioredis re-syncs
          // subscriptions on reconnect anyway.
        }
      }
      stopGaugeLoggingWhenIdle();
    },
  };
}

export interface TrendingTopic {
  count: number;
  hashtag: string;
}

const TRENDING_TOPICS_KEY = "trending:topics";
const TRENDING_TOPICS_BACKUP_KEY = "trending:topics:backup";
const CACHE_TTL = 3600;
const BACKUP_TTL = 86_400;

export const trendingTopicsCache = {
  async get(): Promise<TrendingTopic[]> {
    try {
      const topics = await redis.get(TRENDING_TOPICS_KEY);
      return topics ? JSON.parse(topics) : [];
    } catch (error) {
      console.error("Error getting trending topics from cache:", error);
      return this.getBackup();
    }
  },

  async getBackup(): Promise<TrendingTopic[]> {
    try {
      const backupTopics = await redis.get(TRENDING_TOPICS_BACKUP_KEY);
      return backupTopics ? JSON.parse(backupTopics) : [];
    } catch (error) {
      console.error("Error getting trending topics from backup cache:", error);
      return [];
    }
  },

  async invalidate(): Promise<void> {
    try {
      const pipeline = redis.pipeline();
      pipeline.del(TRENDING_TOPICS_KEY);
      pipeline.del(`${TRENDING_TOPICS_KEY}:last_updated`);
      await pipeline.exec();
      console.log("Invalidated trending topics cache");
    } catch (error) {
      console.error("Error invalidating trending topics cache:", error);
    }
  },

  refreshCache: null as unknown as () => Promise<TrendingTopic[]>,

  async set(topics: TrendingTopic[]): Promise<void> {
    try {
      const pipeline = redis.pipeline();

      pipeline.set(
        TRENDING_TOPICS_KEY,
        JSON.stringify(topics),
        "EX",
        CACHE_TTL
      );

      pipeline.set(
        TRENDING_TOPICS_BACKUP_KEY,
        JSON.stringify(topics),
        "EX",
        BACKUP_TTL
      );

      pipeline.set(
        `${TRENDING_TOPICS_KEY}:last_updated`,
        Date.now(),
        "EX",
        CACHE_TTL
      );

      await pipeline.exec();
    } catch (error) {
      console.error("Error setting trending topics cache:", error);
    }
  },

  async shouldRefresh(): Promise<boolean> {
    try {
      const lastUpdated = await redis.get(
        `${TRENDING_TOPICS_KEY}:last_updated`
      );
      if (!lastUpdated) {
        return true;
      }
      const timeSinceUpdate = Date.now() - Math.trunc(Number(lastUpdated));
      return timeSinceUpdate > (CACHE_TTL * 1000) / 2;
    } catch {
      return true;
    }
  },

  async warmCache(): Promise<void> {
    try {
      const shouldWarm = await this.shouldRefresh();
      if (!shouldWarm) {
        return;
      }
      await this.refreshCache();
    } catch (error) {
      console.error("Error warming trending topics cache:", error);
    }
  },
};

export const POST_VIEWS_KEY_PREFIX = "post:views:";
export const POST_VIEWS_SET = "posts:with:views";
export const JWKS_CACHE_KEY = "jwks:cache";
export const SESSION_CACHE_KEY_PREFIX = "session:cache:";
export const JWKS_CACHE_TTL = 3600;
export const SESSION_CACHE_TTL = 300;

// Real-time eddies: new comments and comment deletions are published to a
// per-post Redis channel and fanned out to open SSE streams. Pub/sub is used
// instead of a list/stream so the fan-out happens in Redis and every web
// instance (not just the one that handled the write) sees the event.
export const COMMENT_CHANNEL_PREFIX = "comments:";
export const commentChannel = (postId: string): string =>
  `${COMMENT_CHANNEL_PREFIX}${postId}`;

export interface CommentStreamEvent {
  kind: "comment.created" | "comment.deleted";
  postId: string;
  comment: unknown;
}

export function serializeCommentEvent(event: CommentStreamEvent): string {
  return JSON.stringify(event);
}

export function parseCommentEvent(raw: string): CommentStreamEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CommentStreamEvent>;
    if (
      parsed.kind !== "comment.created" &&
      parsed.kind !== "comment.deleted"
    ) {
      return null;
    }
    if (typeof parsed.postId !== "string" || parsed.comment === undefined) {
      return null;
    }
    return {
      comment: parsed.comment,
      kind: parsed.kind,
      postId: parsed.postId,
    };
  } catch {
    return null;
  }
}

export async function publishCommentEvent(
  event: CommentStreamEvent
): Promise<void> {
  try {
    await redis.publish(
      commentChannel(event.postId),
      serializeCommentEvent(event)
    );
  } catch (error) {
    console.error("Error publishing comment event:", error);
  }
}

export async function publishCommentCreated(
  postId: string,
  comment: unknown
): Promise<void> {
  await publishCommentEvent({ comment, kind: "comment.created", postId });
}

export async function publishCommentDeleted(
  postId: string,
  comment: unknown
): Promise<void> {
  await publishCommentEvent({ comment, kind: "comment.deleted", postId });
}

// ---- E2EE messages ---------------------------------------------------------
// Real-time DMs: message writes are published to a per-conversation Redis
// channel and fanned out to open SSE streams, mirroring the comments stack.
// Ciphertext is safe to broadcast; the plaintext never leaves the client.
export const MESSAGE_CHANNEL_PREFIX = "messages:";
export const messageChannel = (conversationId: string): string =>
  `${MESSAGE_CHANNEL_PREFIX}${conversationId}`;

export interface MessageStreamEvent {
  kind:
    | "message.created"
    | "message.deleted"
    | "conversation.created"
    | "conversation.read"
    | "typing.started";
  conversationId: string;
  message?: unknown;
  conversation?: unknown;
  userId?: string;
}

export function serializeMessageEvent(event: MessageStreamEvent): string {
  return JSON.stringify(event);
}

export function parseMessageEvent(raw: string): MessageStreamEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MessageStreamEvent>;
    if (
      parsed.kind !== "message.created" &&
      parsed.kind !== "message.deleted" &&
      parsed.kind !== "conversation.created" &&
      parsed.kind !== "conversation.read" &&
      parsed.kind !== "typing.started"
    ) {
      return null;
    }
    if (typeof parsed.conversationId !== "string") {
      return null;
    }
    if (
      (parsed.kind === "message.created" ||
        parsed.kind === "message.deleted") &&
      parsed.message === undefined
    ) {
      return null;
    }
    if (
      parsed.kind === "conversation.created" &&
      parsed.conversation === undefined
    ) {
      return null;
    }
    if (parsed.kind === "typing.started" && typeof parsed.userId !== "string") {
      return null;
    }
    return {
      conversation: parsed.conversation,
      conversationId: parsed.conversationId,
      kind: parsed.kind,
      message: parsed.message,
      userId: parsed.userId,
    };
  } catch {
    return null;
  }
}

export async function publishMessageEvent(
  event: MessageStreamEvent
): Promise<void> {
  try {
    await redis.publish(
      messageChannel(event.conversationId),
      serializeMessageEvent(event)
    );
  } catch (error) {
    console.error("Error publishing message event:", error);
  }
}

export async function publishMessageCreated(
  conversationId: string,
  message: unknown
): Promise<void> {
  await publishMessageEvent({
    conversationId,
    kind: "message.created",
    message,
  });
}

export async function publishMessageDeleted(
  conversationId: string,
  message: unknown
): Promise<void> {
  await publishMessageEvent({
    conversationId,
    kind: "message.deleted",
    message,
  });
}

export async function publishConversationRead(
  conversationId: string,
  userId: string
): Promise<void> {
  await publishMessageEvent({
    conversationId,
    kind: "conversation.read",
    userId,
  });
}

export async function publishTypingStarted(
  conversationId: string,
  userId: string
): Promise<void> {
  await publishMessageEvent({
    conversationId,
    kind: "typing.started",
    userId,
  });
}

// ---- presence ---------------------------------------------------------------
// Users on the Messages page heartbeat their online status every 30s. The
// per-user key carries the TTL so a stale heartbeat expires on its own, and
// the sets are only indexes over those keys (stale members are pruned on
// read). Two tiers:
//   - online: heartbeat received within PRESENCE_TTL_SECONDS (green dot)
//   - idle:   seen within PRESENCE_SEEN_TTL_SECONDS but no recent heartbeat
//             (amber dot) — e.g. the tab is open but the user stepped away
//             past the heartbeat window, or they closed it moments ago.
export const PRESENCE_PREFIX = "presence:";
export const PRESENCE_SEEN_PREFIX = "presence:seen:";
export const PRESENCE_ONLINE_SET = "presence:online";
export const PRESENCE_SEEN_SET = "presence:seen";
export const PRESENCE_TTL_SECONDS = 70;
export const PRESENCE_SEEN_TTL_SECONDS = 900;

export async function markUserOnline(userId: string): Promise<void> {
  try {
    const pipeline = redis.pipeline();
    pipeline.setex(
      `${PRESENCE_PREFIX}${userId}`,
      PRESENCE_TTL_SECONDS,
      String(Date.now())
    );
    pipeline.setex(
      `${PRESENCE_SEEN_PREFIX}${userId}`,
      PRESENCE_SEEN_TTL_SECONDS,
      String(Date.now())
    );
    pipeline.sadd(PRESENCE_ONLINE_SET, userId);
    pipeline.sadd(PRESENCE_SEEN_SET, userId);
    await pipeline.exec();
  } catch (error) {
    console.error("Error marking user online:", error);
  }
}

// Returns members whose per-user online key is still alive, pruning (srem)
// members whose key expired. The key is the source of truth; without this
// prune the set would keep everyone online forever.
export async function getOnlineUsers(): Promise<string[]> {
  try {
    const members = await redis.smembers(PRESENCE_ONLINE_SET);
    if (members.length === 0) {
      return [];
    }
    const pipeline = redis.pipeline();
    for (const id of members) {
      pipeline.get(`${PRESENCE_PREFIX}${id}`);
    }
    const results = await pipeline.exec();

    const online: string[] = [];
    const stale: string[] = [];
    for (let index = 0; index < members.length; index += 1) {
      const value = results?.[index]?.[1];
      if (typeof value === "string") {
        online.push(members[index]);
      } else {
        stale.push(members[index]);
      }
    }
    if (stale.length > 0) {
      await redis.srem(PRESENCE_ONLINE_SET, ...stale);
    }
    return online;
  } catch (error) {
    console.error("Error getting online users:", error);
    return [];
  }
}

// Users seen recently but not currently online (heartbeat expired within the
// seen window). Prunes seen members whose seen key expired. Accepts the
// already-computed online list so the caller (the presence route) does not
// query the online set twice per poll.
export async function getIdleUsers(onlineList: string[]): Promise<string[]> {
  try {
    const seen = await redis.smembers(PRESENCE_SEEN_SET);
    if (seen.length === 0) {
      return [];
    }
    const online = new Set(onlineList);
    const candidates = seen.filter((id) => !online.has(id));
    if (candidates.length === 0) {
      return [];
    }

    const pipeline = redis.pipeline();
    for (const id of candidates) {
      pipeline.get(`${PRESENCE_SEEN_PREFIX}${id}`);
    }
    const results = await pipeline.exec();

    const idle: string[] = [];
    const stale: string[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const value = results?.[index]?.[1];
      if (typeof value === "string") {
        idle.push(candidates[index]);
      } else {
        stale.push(candidates[index]);
      }
    }
    if (stale.length > 0) {
      await redis.srem(PRESENCE_SEEN_SET, ...stale);
    }
    return idle;
  } catch (error) {
    console.error("Error getting idle users:", error);
    return [];
  }
}

// Redis Streams that buffer high-frequency counter increments for the worker.
// The web app XADDs a small event per increment; the worker drains them in
// batches (XREADGROUP) and flushes the aggregate deltas to Postgres.
export const VIEWS_STREAM = "views:stream";
export const VIEWS_GROUP = "views-flush";
export const VIEWS_CONSUMER_PREFIX = "views-worker";

export const SHARE_STREAM = "share:stream";
export const SHARE_GROUP = "share-flush";
export const SHARE_CONSUMER_PREFIX = "share-worker";

export async function ensureStreamGroups(): Promise<void> {
  await Promise.all([
    ensureGroup(VIEWS_STREAM, VIEWS_GROUP),
    ensureGroup(SHARE_STREAM, SHARE_GROUP),
  ]);
}

async function ensureGroup(stream: string, group: string): Promise<void> {
  try {
    await redis.xgroup("CREATE", stream, group, "0", "MKSTREAM");
  } catch (error) {
    // BUSYGROUP means the group already exists, which is fine.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("BUSYGROUP")) {
      console.error(`Error creating consumer group ${group}:`, error);
    }
  }
}

export async function enqueueViewIncrement(postId: string): Promise<void> {
  try {
    await redis.xadd(
      VIEWS_STREAM,
      "MAXLEN",
      "~",
      10_000,
      "*",
      "postId",
      postId
    );
  } catch (error) {
    console.error("Error enqueuing view increment:", error);
  }
}

export async function enqueueShareEvent(
  postId: string,
  platform: string,
  kind: "share" | "click"
): Promise<void> {
  try {
    await redis.xadd(
      SHARE_STREAM,
      "MAXLEN",
      "~",
      10_000,
      "*",
      "postId",
      postId,
      "platform",
      platform,
      "kind",
      kind
    );
  } catch (error) {
    console.error("Error enqueuing share event:", error);
  }
}

// Best-effort one-shot claim backed by SET NX EX. Returns true when this
// caller is the first to claim `key` inside the TTL window. Used for
// exactly-once semantics on soft events (view counting, share clicks) where
// dropping a duplicate is always preferable to counting it twice. Fails open
// (returns true) when Redis is unreachable so real events are never lost.
export async function claimOnce(
  key: string,
  ttlSeconds: number
): Promise<boolean> {
  try {
    // ioredis resolves SET ... NX to "OK" when the key was claimed and to
    // null when it already existed, so only "OK" counts as a fresh claim.
    const result = await redis.set(key, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  } catch (error) {
    console.error("claim-once redis unavailable, failing open:", error);
    return true;
  }
}

// Anonymous viewers may bump a post's view count at most once per this window
// (per hashed IP); signed-in viewers always count.
const ANON_VIEW_DEDUP_TTL_SECONDS = 900;

// Atomically claims the dedupe key and increments the counter in one script so
// a duplicate claim can never race an increment (no double-count window).
// KEYS[1] = dedupe key ("" when there is no viewer identity), KEYS[2] = the
// set of posts with counters, KEYS[3] = the per-post counter. Returns the
// current counter for a duplicate claim, or the new counter after INCR.
const CLAIM_AND_INCREMENT_SCRIPT = `
local claimed = true
if KEYS[1] ~= "" then
  local ok = redis.call("SET", KEYS[1], "1", "EX", tonumber(ARGV[1]), "NX")
  if not ok then
    local current = redis.call("GET", KEYS[3])
    if current then return tonumber(current) end
    return 0
  end
end
redis.call("SADD", KEYS[2], ARGV[2])
return redis.call("INCR", KEYS[3])
`;

export const postViewsCache = {
  async getMultipleViews(postIds: string[]): Promise<Record<string, number>> {
    try {
      const pipeline = redis.pipeline();
      for (const id of postIds) {
        pipeline.get(`${POST_VIEWS_KEY_PREFIX}${id}`);
      }

      const results = await pipeline.exec();

      const views: Record<string, number> = {};
      for (let index = 0; index < postIds.length; index += 1) {
        const id = postIds[index];
        views[id] = Math.trunc(
          Number((results?.[index]?.[1] as string) || "0")
        );
      }
      return views;
    } catch (error) {
      console.error("Error getting multiple post views:", error);
      return {};
    }
  },

  async getViews(postId: string): Promise<number> {
    try {
      const views = await redis.get(`${POST_VIEWS_KEY_PREFIX}${postId}`);
      console.log(`Redis: Got views for post ${postId}: ${views}`);
      return Math.trunc(Number(views || "0"));
    } catch (error) {
      console.error("Error getting post views:", error);
      return 0;
    }
  },

  async incrementView(
    postId: string,
    viewer?: { userId?: string; viewerHash?: string }
  ): Promise<number> {
    try {
      // Signed-in viewers count on every screenview - repeat views of a fleet
      // or gust are real engagement. Only anonymous clients dedupe, via a per
      // IP-hash claim (15 minutes) so guest refresh loops cannot pump counts.
      // The claim and counter bump run in one atomic script so a duplicate
      // claim can never double-count. Fails open (returns 0) when Redis is
      // down so real views are never dropped by an infrastructure hiccup.
      let dedupeKey = "";
      if (!viewer?.userId && viewer?.viewerHash) {
        dedupeKey = `${POST_VIEWS_KEY_PREFIX}seen:${postId}:a:${viewer.viewerHash}`;
      }
      const newCount = Number(
        await redis.eval(
          CLAIM_AND_INCREMENT_SCRIPT,
          3,
          dedupeKey,
          POST_VIEWS_SET,
          `${POST_VIEWS_KEY_PREFIX}${postId}`,
          ANON_VIEW_DEDUP_TTL_SECONDS,
          postId
        )
      );

      await enqueueViewIncrement(postId);

      return newCount;
    } catch (error) {
      console.error("Error incrementing post view:", error);
      return 0;
    }
  },

  async isInViewSet(postId: string): Promise<boolean> {
    try {
      return (await redis.sismember(POST_VIEWS_SET, postId)) === 1;
    } catch (error) {
      console.error("Error checking post in view set:", error);
      return false;
    }
  },
};

// Adds the live Redis view delta on top of each post's persisted viewCount so
// the UI shows near-instant counts while the worker batch-flushes deltas to
// Postgres. Accepts any array of objects that carry `id` and `viewCount`.
// Also normalizes viewer-scoped joins (`bookmarks`, `vote`) that older caches
// or optimistically constructed rows may omit, so downstream
// `post.bookmarks.some(...)` never throws in production (the "some is undefined"
// Next.js 12 crash).
export async function hydrateViewCounts<
  T extends { id: string; viewCount: number },
>(items: T[]): Promise<T[]> {
  if (items.length === 0) {
    return items;
  }
  const deltas = await postViewsCache.getMultipleViews(
    items.map((item) => item.id)
  );
  return items.map((item) => {
    const viewCount = item.viewCount + (deltas[item.id] ?? 0);
    const record = item as unknown as Record<string, unknown>;
    // If this is a PostData-like row, patch missing viewer joins. Spread
    // first so the original is not mutated, then assign defaults only when
    // the field is not already an array.
    const next: T = { ...item, viewCount } as T;
    const isPostLike = "aura" in record && "userId" in record;
    if (
      (isPostLike || "bookmarks" in record) &&
      !Array.isArray(record.bookmarks)
    ) {
      (next as unknown as Record<string, unknown>).bookmarks = [];
    }
    if ((isPostLike || "vote" in record) && !Array.isArray(record.vote)) {
      (next as unknown as Record<string, unknown>).vote = [];
    }
    if (
      (isPostLike || "attachments" in record) &&
      !Array.isArray(record.attachments)
    ) {
      (next as unknown as Record<string, unknown>).attachments = [];
    }
    if ((isPostLike || "tags" in record) && !Array.isArray(record.tags)) {
      (next as unknown as Record<string, unknown>).tags = [];
    }
    if (
      (isPostLike || "mentions" in record) &&
      !Array.isArray(record.mentions)
    ) {
      (next as unknown as Record<string, unknown>).mentions = [];
    }
    if (isPostLike || "_count" in record) {
      const count = record._count as Record<string, unknown> | undefined;
      if (!count || typeof count !== "object") {
        (next as unknown as Record<string, unknown>)._count = {
          comments: 0,
          mentions: 0,
          vote: 0,
        };
      }
    }
    return next;
  });
}

export interface CachedSession {
  session: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    expiresAt: Date;
    token: string;
    ipAddress?: string;
    userAgent?: string;
  };
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string;
    username?: string;
    createdAt: Date;
    updatedAt: Date;
  };
}

export const jwtSessionCache = {
  createTokenHash(token: string): string {
    return createHash("sha256").update(token).digest("hex").slice(0, 16);
  },

  async getJWKS(): Promise<JSONWebKeySet | null> {
    try {
      const cached = await redis.get(JWKS_CACHE_KEY);
      if (cached) {
        console.log("Retrieved JWKS from cache");
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      console.error("Error getting cached JWKS:", error);
      return null;
    }
  },

  async getValidatedSession(tokenHash: string): Promise<CachedSession | null> {
    try {
      const cached = await redis.get(`${SESSION_CACHE_KEY_PREFIX}${tokenHash}`);
      if (cached) {
        console.log(
          `Retrieved validated session from cache for token hash: ${tokenHash.slice(0, 8)}...`
        );
        const sessionData = JSON.parse(cached);
        sessionData.session.expiresAt = new Date(sessionData.session.expiresAt);
        sessionData.user.createdAt = new Date(sessionData.user.createdAt);
        sessionData.user.updatedAt = new Date(sessionData.user.updatedAt);
        return sessionData;
      }
      return null;
    } catch (error) {
      console.error("Error getting cached validated session:", error);
      return null;
    }
  },

  async invalidateSession(tokenHash: string): Promise<void> {
    try {
      await redis.del(`${SESSION_CACHE_KEY_PREFIX}${tokenHash}`);
      console.log(
        `Invalidated cached session for token hash: ${tokenHash.slice(0, 8)}...`
      );
    } catch (error) {
      console.error("Error invalidating cached session:", error);
    }
  },

  async setJWKS(jwks: JSONWebKeySet): Promise<void> {
    try {
      await redis.setex(JWKS_CACHE_KEY, JWKS_CACHE_TTL, JSON.stringify(jwks));
      console.log("Cached JWKS in Redis");
    } catch (error) {
      console.error("Error caching JWKS:", error);
    }
  },

  async setValidatedSession(
    tokenHash: string,
    sessionData: CachedSession
  ): Promise<void> {
    try {
      await redis.setex(
        `${SESSION_CACHE_KEY_PREFIX}${tokenHash}`,
        SESSION_CACHE_TTL,
        JSON.stringify(sessionData)
      );
      console.log(
        `Cached validated session for token hash: ${tokenHash.slice(0, 8)}...`
      );
    } catch (error) {
      console.error("Error caching validated session:", error);
    }
  },
};
