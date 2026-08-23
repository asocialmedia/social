import { redis } from "../src/redis";
import type { SearchPostResult, SearchUserResult } from "../src/search";

export interface SearchSuggestion {
  count: number;
  query: string;
}

export type SearchHistoryItem =
  | {
      query: string;
      raw: string;
      resultCount?: number;
      searchedAt?: number;
      type: "query";
    }
  | {
      raw: string;
      searchedAt?: number;
      type: "user";
      user: SearchUserResult;
    }
  | {
      post: SearchPostResult;
      raw: string;
      searchedAt?: number;
      type: "post";
    };

export function parseHistoryEntry(raw: string): SearchHistoryItem {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "type" in parsed) {
      if (parsed.type === "user" && parsed.user) {
        return {
          raw,
          searchedAt:
            typeof parsed.searchedAt === "number"
              ? parsed.searchedAt
              : undefined,
          type: "user",
          user: parsed.user,
        };
      }
      if (parsed.type === "post" && parsed.post) {
        return {
          post: {
            ...parsed.post,
            createdAt: parsed.post.createdAt
              ? new Date(parsed.post.createdAt)
              : new Date(),
          },
          raw,
          searchedAt:
            typeof parsed.searchedAt === "number"
              ? parsed.searchedAt
              : undefined,
          type: "post",
        };
      }
      if (parsed.type === "query" && typeof parsed.query === "string") {
        return {
          query: parsed.query,
          raw,
          resultCount:
            typeof parsed.resultCount === "number"
              ? parsed.resultCount
              : undefined,
          searchedAt:
            typeof parsed.searchedAt === "number"
              ? parsed.searchedAt
              : undefined,
          type: "query",
        };
      }
    }
  } catch {
    // Legacy plain string query in Redis
  }
  return { query: raw, raw, type: "query" };
}

const SEARCH_HISTORY_TTL = 60 * 60 * 24 * 30; // 30 days
const SUGGESTIONS_TTL = 60 * 60 * 24 * 7; // 7 days
const MAX_HISTORY_ITEMS = 10;
const MAX_SUGGESTIONS = 100;

export const searchSuggestionsCache = {
  async addPostToHistory(
    userId: string,
    post: SearchPostResult
  ): Promise<void> {
    try {
      if (!post?.id) {
        return;
      }

      const key = `user:${userId}:search:history`;

      // Remove existing entry for this post ID to dedupe and bump score
      const existing = await redis.zrevrange(key, 0, -1);
      const stale = existing.filter((raw) => {
        const item = parseHistoryEntry(raw);
        return item.type === "post" && item.post.id === post.id;
      });

      const member = JSON.stringify({
        post,
        searchedAt: Date.now(),
        type: "post",
      });
      const pipeline = redis.pipeline();
      if (stale.length > 0) {
        pipeline.zrem(key, ...stale);
      }
      pipeline.zadd(key, Date.now(), member);
      pipeline.zremrangebyrank(key, 0, -MAX_HISTORY_ITEMS - 1);
      pipeline.expire(key, SEARCH_HISTORY_TTL);
      await pipeline.exec();
    } catch (error) {
      console.error("Error adding post to search history:", error);
    }
  },

  async addSuggestion(query: string): Promise<void> {
    try {
      if (!query.trim()) {
        return;
      }

      const normalizedQuery = query.toLowerCase().trim();
      const key = "search:suggestions";

      const pipeline = redis.pipeline();
      pipeline.zincrby(key, 1, normalizedQuery);
      pipeline.zremrangebyrank(key, 0, -MAX_SUGGESTIONS - 1);
      pipeline.expire(key, SUGGESTIONS_TTL);

      await pipeline.exec();
    } catch (error) {
      console.error("Error adding search suggestion:", error);
    }
  },

  async addToHistory(
    userId: string,
    query: string,
    resultCount?: number
  ): Promise<void> {
    try {
      const trimmed = query.trim();
      if (!trimmed) {
        return;
      }

      const key = `user:${userId}:search:history`;
      const normalizedQuery = trimmed.toLowerCase();

      // Remove existing matches for this query to dedupe and bump score
      const existing = await redis.zrevrange(key, 0, -1);
      const stale = existing.filter((raw) => {
        const item = parseHistoryEntry(raw);
        return (
          (item.type === "query" &&
            item.query.toLowerCase() === normalizedQuery) ||
          raw === trimmed ||
          raw === normalizedQuery
        );
      });

      const member = JSON.stringify({
        query: trimmed,
        resultCount: typeof resultCount === "number" ? resultCount : undefined,
        searchedAt: Date.now(),
        type: "query",
      });
      const pipeline = redis.pipeline();
      if (stale.length > 0) {
        pipeline.zrem(key, ...stale);
      }
      pipeline.zadd(key, Date.now(), member);
      pipeline.zremrangebyrank(key, 0, -MAX_HISTORY_ITEMS - 1);
      pipeline.expire(key, SEARCH_HISTORY_TTL);
      await pipeline.exec();
    } catch (error) {
      console.error("Error adding to search history:", error);
    }
  },

  async addUserToHistory(
    userId: string,
    user: SearchUserResult
  ): Promise<void> {
    try {
      if (!user?.id) {
        return;
      }

      const key = `user:${userId}:search:history`;

      // Remove existing entry for this user ID to dedupe and bump score
      const existing = await redis.zrevrange(key, 0, -1);
      const stale = existing.filter((raw) => {
        const item = parseHistoryEntry(raw);
        return item.type === "user" && item.user.id === user.id;
      });

      const member = JSON.stringify({
        searchedAt: Date.now(),
        type: "user",
        user,
      });
      const pipeline = redis.pipeline();
      if (stale.length > 0) {
        pipeline.zrem(key, ...stale);
      }
      pipeline.zadd(key, Date.now(), member);
      pipeline.zremrangebyrank(key, 0, -MAX_HISTORY_ITEMS - 1);
      pipeline.expire(key, SEARCH_HISTORY_TTL);
      await pipeline.exec();
    } catch (error) {
      console.error("Error adding user to search history:", error);
    }
  },

  async clearHistory(userId: string): Promise<void> {
    try {
      await redis.del(`user:${userId}:search:history`);
    } catch (error) {
      console.error("Error clearing search history:", error);
    }
  },

  async getHistory(userId: string): Promise<SearchHistoryItem[]> {
    try {
      const key = `user:${userId}:search:history`;
      const rawList = await redis.zrevrange(key, 0, MAX_HISTORY_ITEMS - 1);
      return rawList.map(parseHistoryEntry);
    } catch (error) {
      console.error("Error getting search history:", error);
      return [];
    }
  },

  async getSuggestions(prefix: string, limit = 5): Promise<SearchSuggestion[]> {
    try {
      if (!prefix.trim()) {
        return [];
      }

      const normalizedPrefix = prefix.toLowerCase().trim();
      const key = "search:suggestions";

      const results = await redis.zrevrange(key, 0, -1, "WITHSCORES");
      const suggestions: SearchSuggestion[] = [];
      for (let i = 0; i < results.length; i += 2) {
        const query = results[i];
        const count = Math.trunc(Number(results[i + 1] || "0"));

        if (query.startsWith(normalizedPrefix)) {
          suggestions.push({ count, query });
          if (suggestions.length >= limit) {
            break;
          }
        }
      }

      return suggestions;
    } catch (error) {
      console.error("Error getting search suggestions:", error);
      return [];
    }
  },

  async removeHistoryItem(userId: string, target: string): Promise<void> {
    try {
      const key = `user:${userId}:search:history`;
      const trimmedTarget = target.trim();
      const removed = await redis.zrem(key, trimmedTarget);
      if (removed === 0) {
        const existing = await redis.zrevrange(key, 0, -1);
        const stale = existing.filter((raw) => {
          const item = parseHistoryEntry(raw);
          return (
            (item.type === "query" &&
              (item.query === trimmedTarget ||
                item.query.toLowerCase() === trimmedTarget.toLowerCase())) ||
            (item.type === "user" &&
              (item.user.id === trimmedTarget ||
                item.user.username === trimmedTarget)) ||
            (item.type === "post" && item.post.id === trimmedTarget) ||
            raw === trimmedTarget
          );
        });
        if (stale.length > 0) {
          await redis.zrem(key, ...stale);
        }
      }
    } catch (error) {
      console.error("Error removing history item:", error);
    }
  },
};

export const searchCache = {
  addPostToHistory: searchSuggestionsCache.addPostToHistory,
  addSuggestion: searchSuggestionsCache.addSuggestion,
  addToHistory: searchSuggestionsCache.addToHistory,
  addUserToHistory: searchSuggestionsCache.addUserToHistory,
  getHistory: searchSuggestionsCache.getHistory,
  getSuggestions: searchSuggestionsCache.getSuggestions,
};
