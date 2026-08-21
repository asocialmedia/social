import { describe, expect, test } from "bun:test";

import { resolveApiTier } from "./api-security";

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
