import { beforeEach, describe, expect, mock, test } from "bun:test";

import { guardApiRequest, resolveApiTier } from "./api-security";

const mockConsumeRateLimit = mock((_options: unknown) => ({
  allowed: true,
  remaining: 10,
  resetAt: Date.now() + 60_000,
  retryAfterSeconds: 0,
}));

mock.module("@asm/db", () => ({
  consumeRateLimit: mockConsumeRateLimit,
}));

describe("resolveApiTier", () => {
  test("non-api paths are never limited", () => {
    expect(resolveApiTier("/")).toBeNull();
    expect(resolveApiTier("/login")).toBeNull();
    expect(resolveApiTier("/users/someone/posts")).toBeNull();
  });

  test("health endpoint is exempt", () => {
    expect(resolveApiTier("/api/health")).toBeNull();
  });

  test("media gets the highest limit", () => {
    const tier = resolveApiTier("/api/media/cmt123");
    expect(tier?.bucket).toBe("media");
    expect(tier?.limitPerMinute).toBeGreaterThan(300);
  });

  test("uploads get the tightest per-ip limit", () => {
    const tier = resolveApiTier("/api/upload");
    expect(tier?.bucket).toBe("upload");
    expect(tier?.limitPerMinute).toBeLessThan(60);
  });

  test("expensive reads land in the heavy tier", () => {
    for (const path of [
      "/api/search?q=a",
      "/api/posts/for-you",
      "/api/posts/trending",
      "/api/posts/following",
    ]) {
      expect(resolveApiTier(path)?.bucket).toBe("heavy-read");
    }
  });

  test("everything else uses the default api tier", () => {
    for (const path of [
      "/api/tags",
      "/api/notifications",
      "/api/hackernews?page=1",
      "/api/posts/cmt123/votes",
    ]) {
      expect(resolveApiTier(path)?.bucket).toBe("api");
    }
  });
});

describe("guardApiRequest", () => {
  beforeEach(() => {
    mockConsumeRateLimit.mockClear();
    mockConsumeRateLimit.mockImplementation((_options: unknown) => ({
      allowed: true,
      remaining: 10,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 0,
    }));
  });

  test("lets an allowed request through with no response", async () => {
    const result = await guardApiRequest("/api/posts/for-you", "198.51.100.7");
    expect(result.response).toBeNull();
    expect(mockConsumeRateLimit).toHaveBeenCalledTimes(1);
    const options = mockConsumeRateLimit.mock.calls[0]?.[0] as {
      bucket: string;
      identifier: string;
      limit: number;
      windowSeconds: number;
    };
    expect(options.bucket).toBe("heavy-read");
    expect(options.identifier).toBe("198.51.100.7");
    expect(options.windowSeconds).toBe(60);
  });

  test("returns 429 with Retry-After when denied", async () => {
    mockConsumeRateLimit.mockImplementationOnce(() => ({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 42,
    }));
    const result = await guardApiRequest("/api/media/cmt123", "198.51.100.7");
    expect(result.response).not.toBeNull();
    expect(result.response?.status).toBe(429);
    expect(result.response?.headers.get("retry-after")).toBe("42");
  });

  test("never limits exempt health paths", async () => {
    const result = await guardApiRequest("/api/health", "198.51.100.7");
    expect(result.response).toBeNull();
    expect(mockConsumeRateLimit).not.toHaveBeenCalled();
  });
});
