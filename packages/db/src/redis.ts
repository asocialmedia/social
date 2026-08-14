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

  async incrementView(postId: string, _userId?: string): Promise<number> {
    try {
      // Impression-style counting: every screenview increments, no per-user
      // The client bounces identical refreshes, so
      // this stays reasonable while the number moves visibly.
      const pipeline = redis.pipeline();
      pipeline.sadd(POST_VIEWS_SET, postId);
      pipeline.incr(`${POST_VIEWS_KEY_PREFIX}${postId}`);
      const results = await pipeline.exec();

      const newCount = (results?.[1]?.[1] as number) || 0;
      console.log(`Redis: Incremented view for post ${postId} to ${newCount}`);

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
export async function hydrateViewCounts<
  T extends { id: string; viewCount: number },
>(items: T[]): Promise<T[]> {
  if (items.length === 0) {
    return items;
  }
  const deltas = await postViewsCache.getMultipleViews(
    items.map((item) => item.id)
  );
  return items.map((item) => ({
    ...item,
    viewCount: item.viewCount + (deltas[item.id] ?? 0),
  }));
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
