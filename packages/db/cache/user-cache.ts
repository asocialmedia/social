import { redis } from "../src/redis";

export interface CachedUserStats {
  adminUsers: number;
  recentUsers: number;
  totalAura: number;
  totalPosts: number;
  totalUsers: number;
  verifiedUsers: number;
}

const USER_STATS_CACHE_KEY = "admin:user:stats";
const USER_STATS_TTL = 300;
const USER_LIST_CACHE_KEY_PREFIX = "admin:users:list";
const USER_LIST_TTL = 300;
const USER_DETAIL_CACHE_KEY_PREFIX = "admin:user:detail";
const USER_DETAIL_TTL = 600;
const USER_ANALYTICS_CACHE_KEY_PREFIX = "admin:analytics";
const USER_ANALYTICS_TTL = 600;
const USER_ACTIVITY_CACHE_KEY_PREFIX = "admin:user:activity";
const USER_ACTIVITY_TTL = 300;
const USER_SEARCH_CACHE_KEY_PREFIX = "admin:search";
const USER_SEARCH_TTL = 600;
const RATE_LIMIT_PREFIX = "ratelimit:admin";
const RATE_LIMIT_WINDOW = 60;
const RATE_LIMIT_MAX_REQUESTS = 100;

function doesKeyContainSearchQuery(key: string, searchQuery: string): boolean {
  try {
    const prefix = `${USER_SEARCH_CACHE_KEY_PREFIX}:`;
    if (!key.startsWith(prefix)) {
      return false;
    }

    const keyData = key.slice(prefix.length);
    const [base64Part] = keyData.split(":");
    if (!base64Part) {
      return false;
    }

    const decoded = Buffer.from(base64Part, "base64").toString("utf-8");
    const filters = JSON.parse(decoded);

    return filters.search === searchQuery;
  } catch {
    return false;
  }
}

export const userCache = {
  async setUserStats(stats: CachedUserStats): Promise<void> {
    try {
      await redis.setex(
        USER_STATS_CACHE_KEY,
        USER_STATS_TTL,
        JSON.stringify(stats)
      );
    } catch (error) {
      console.error("Error caching user stats:", error);
    }
  },

  async getUserStats(): Promise<CachedUserStats | null> {
    try {
      const cached = await redis.get(USER_STATS_CACHE_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      console.error("Error getting cached user stats:", error);
      return null;
    }
  },

  generateUserListKey(
    filters: Record<string, unknown>,
    sortBy: string,
    sortOrder: string,
    limit: number
  ): string {
    const filterStr = JSON.stringify(filters);
    return `${USER_LIST_CACHE_KEY_PREFIX}:${Buffer.from(filterStr).toString("base64")}:${sortBy}:${sortOrder}:${limit}`;
  },

  async setUserList(
    key: string,
    data: {
      users: unknown[];
      totalCount: number;
      hasMore: boolean;
      nextCursor?: string;
    }
  ): Promise<void> {
    try {
      const cacheData = {
        ...data,
        cachedAt: Date.now(),
      };
      await redis.setex(key, USER_LIST_TTL, JSON.stringify(cacheData));
    } catch (error) {
      console.error("Error caching user list:", error);
    }
  },

  async getUserList(key: string): Promise<{
    users: unknown[];
    totalCount: number;
    hasMore: boolean;
    nextCursor?: string;
    cachedAt: number;
  } | null> {
    try {
      const cached = await redis.get(key);
      if (cached) {
        const data = JSON.parse(cached);

        if (Date.now() - data.cachedAt < (USER_LIST_TTL - 60) * 1000) {
          return data;
        }
      }
      return null;
    } catch (error) {
      console.error("Error getting cached user list:", error);
      return null;
    }
  },

  async setUserDetail(userId: string, userData: unknown): Promise<void> {
    try {
      await redis.setex(
        `${USER_DETAIL_CACHE_KEY_PREFIX}:${userId}`,
        USER_DETAIL_TTL,
        JSON.stringify(userData)
      );
    } catch (error) {
      console.error("Error caching user detail:", error);
    }
  },

  async getUserDetail(userId: string): Promise<unknown | null> {
    try {
      const cached = await redis.get(
        `${USER_DETAIL_CACHE_KEY_PREFIX}:${userId}`
      );
      if (cached) {
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      console.error("Error getting cached user detail:", error);
      return null;
    }
  },

  async invalidateUserStats(): Promise<void> {
    try {
      await redis.del(USER_STATS_CACHE_KEY);
    } catch (error) {
      console.error("Error invalidating user stats cache:", error);
    }
  },

  async invalidateUserList(): Promise<void> {
    try {
      await this.scanAndDeleteKeys(`${USER_LIST_CACHE_KEY_PREFIX}:*`);
    } catch (error) {
      console.error("Error invalidating user list cache:", error);
    }
  },

  async invalidateUserDetail(userId: string): Promise<void> {
    try {
      await redis.del(`${USER_DETAIL_CACHE_KEY_PREFIX}:${userId}`);
    } catch (error) {
      console.error("Error invalidating user detail cache:", error);
    }
  },

  async scanAndDeleteKeys(pattern: string): Promise<void> {
    const BATCH_SIZE = 100;

    const scanBatch = async (cursor: number): Promise<void> => {
      const [newCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        BATCH_SIZE
      );

      if (keys.length > 0) {
        const pipeline = redis.pipeline();
        for (const key of keys) {
          pipeline.del(key);
        }
        await pipeline.exec();
      }

      const nextCursor = Number.parseInt(newCursor, 10);
      if (nextCursor !== 0) {
        await scanBatch(nextCursor);
      }
    };

    await scanBatch(0);
  },

  async invalidateAllUserCaches(userId?: string): Promise<void> {
    try {
      const pipeline = redis.pipeline();

      pipeline.del(USER_STATS_CACHE_KEY);

      if (userId) {
        pipeline.del(`${USER_DETAIL_CACHE_KEY_PREFIX}:${userId}`);
        await this.scanAndDeleteKeys(
          `${USER_ACTIVITY_CACHE_KEY_PREFIX}:${userId}:*`
        );
      }

      await pipeline.exec();
    } catch (error) {
      console.error("Error invalidating user caches:", error);
    }
  },

  async setAnalytics(timeframe: string, data: unknown): Promise<void> {
    try {
      await redis.setex(
        `${USER_ANALYTICS_CACHE_KEY_PREFIX}:${timeframe}`,
        USER_ANALYTICS_TTL,
        JSON.stringify(data)
      );
    } catch (error) {
      console.error("Error caching analytics:", error);
    }
  },

  async getAnalytics(timeframe: string): Promise<unknown | null> {
    try {
      const cached = await redis.get(
        `${USER_ANALYTICS_CACHE_KEY_PREFIX}:${timeframe}`
      );
      if (cached) {
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      console.error("Error getting cached analytics:", error);
      return null;
    }
  },

  async setUserActivity(
    userId: string,
    days: number,
    data: unknown
  ): Promise<void> {
    try {
      await redis.setex(
        `${USER_ACTIVITY_CACHE_KEY_PREFIX}:${userId}:${days}`,
        USER_ACTIVITY_TTL,
        JSON.stringify(data)
      );
    } catch (error) {
      console.error("Error caching user activity:", error);
    }
  },

  async getUserActivity(userId: string, days: number): Promise<unknown | null> {
    try {
      const cached = await redis.get(
        `${USER_ACTIVITY_CACHE_KEY_PREFIX}:${userId}:${days}`
      );
      if (cached) {
        return JSON.parse(cached);
      }
      return null;
    } catch (error) {
      console.error("Error getting cached user activity:", error);
      return null;
    }
  },

  async checkRateLimit(
    userId: string
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    try {
      const key = `${RATE_LIMIT_PREFIX}:${userId}`;
      const now = Math.floor(Date.now() / 1000);

      const pipeline = redis.pipeline();

      pipeline.zremrangebyscore(key, 0, now - RATE_LIMIT_WINDOW);

      pipeline.zadd(key, now, `${now}-${Date.now()}-${Math.random()}`);

      pipeline.zcard(key);

      pipeline.expire(key, RATE_LIMIT_WINDOW);

      const results = await pipeline.exec();

      if (!results) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: now + RATE_LIMIT_WINDOW,
        };
      }

      const requestCount = (results[2]?.[1] as number) || 0;
      const allowed = requestCount <= RATE_LIMIT_MAX_REQUESTS;
      const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - requestCount);
      const resetTime = now + RATE_LIMIT_WINDOW;

      return { allowed, remaining, resetTime };
    } catch (error) {
      console.error("Error checking rate limit:", error);

      return {
        allowed: true,
        remaining: RATE_LIMIT_MAX_REQUESTS,
        resetTime: Math.floor(Date.now() / 1000) + RATE_LIMIT_WINDOW,
      };
    }
  },

  async getRateLimitStatus(
    userId: string
  ): Promise<{ requests: number; remaining: number; resetTime: number }> {
    try {
      const key = `${RATE_LIMIT_PREFIX}:${userId}`;
      const now = Math.floor(Date.now() / 1000);

      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, now - RATE_LIMIT_WINDOW);
      pipeline.zcard(key);

      const results = await pipeline.exec();

      const requestCount = (results?.[1]?.[1] as number) || 0;
      const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - requestCount);
      const resetTime = now + RATE_LIMIT_WINDOW;

      return { requests: requestCount, remaining, resetTime };
    } catch (error) {
      console.error("Error getting rate limit status:", error);
      return {
        requests: 0,
        remaining: RATE_LIMIT_MAX_REQUESTS,
        resetTime: Math.floor(Date.now() / 1000) + RATE_LIMIT_WINDOW,
      };
    }
  },

  generateSearchCacheKey(options: {
    searchQuery: string;
    filters: Record<string, unknown>;
    sortBy: string;
    sortOrder: string;
    limit: number;
    cursor?: string;
  }): string {
    const filterStr = JSON.stringify({
      ...options.filters,
      search: options.searchQuery,
    });
    const keyData = `${Buffer.from(filterStr).toString("base64")}:${options.sortBy}:${options.sortOrder}:${options.limit}:${options.cursor || "nocursor"}`;
    return `${USER_SEARCH_CACHE_KEY_PREFIX}:${keyData}`;
  },

  async setSearchResult(
    key: string,
    data: {
      users: unknown[];
      totalCount: number;
      hasMore: boolean;
      nextCursor?: string;
    }
  ): Promise<void> {
    try {
      const cacheData = {
        ...data,
        cachedAt: Date.now(),
        type: "search",
      };
      await redis.setex(key, USER_SEARCH_TTL, JSON.stringify(cacheData));
    } catch (error) {
      console.error("Error caching search result:", error);
    }
  },

  async getSearchResult(key: string): Promise<{
    users: unknown[];
    totalCount: number;
    hasMore: boolean;
    nextCursor?: string;
    cachedAt: number;
    type: string;
  } | null> {
    try {
      const cached = await redis.get(key);
      if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.cachedAt < USER_SEARCH_TTL * 1000 - 120 * 1000) {
          return data;
        }
      }
      return null;
    } catch (error) {
      console.error("Error getting search result from cache:", error);
      return null;
    }
  },

  async invalidateSearchCache(searchQuery?: string): Promise<void> {
    try {
      const allKeys = await redis.keys(`${USER_SEARCH_CACHE_KEY_PREFIX}:*`);
      if (allKeys.length === 0) {
        return;
      }

      let keysToDelete: string[];

      if (searchQuery) {
        keysToDelete = allKeys.filter((key) =>
          doesKeyContainSearchQuery(key, searchQuery)
        );
      } else {
        keysToDelete = allKeys;
      }

      if (keysToDelete.length > 0) {
        const batchSize = 100;
        const batches: string[][] = [];
        for (let i = 0; i < keysToDelete.length; i += batchSize) {
          batches.push(keysToDelete.slice(i, i + batchSize));
        }
        await Promise.all(batches.map((batch) => redis.del(...batch)));
      }
    } catch (error) {
      console.error("Error invalidating search cache:", error);
    }
  },
};
