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

  test("auth proxy is exempt; the auth service owns its own limits", () => {
    // Every authenticated render calls get-session and the session-events
    // stream is long-lived. Counting these here starved unrelated routes
    // (like POST /api/push/device) out of the shared per-IP "api" bucket.
    expect(resolveApiTier("/api/auth/get-session")).toBeNull();
    expect(resolveApiTier("/api/auth/session-events")).toBeNull();
    expect(resolveApiTier("/api/auth/sign-out")).toBeNull();
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
      "/api/posts/latest",
      "/api/posts/trending",
      "/api/posts/following",
      "/api/gusts",
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

  // A feed or profile view pulls one avatar per visible author. These fell
  // through to the 240/min api bucket, so a single page of images exhausted
  // the shared budget and the guard throttled the very page that triggered it.
  test("profile images share the media budget, not the default api budget", () => {
    for (const path of [
      "/api/users/avatar/user123/image",
      "/api/users/banner/user123/image",
      "/api/communities/avatar/cmt1/image",
      "/api/communities/banner/cmt1/image",
      "/api/link-preview/image",
    ]) {
      const tier = resolveApiTier(path);
      expect(tier?.bucket).toBe("media");
      expect(tier?.limitPerMinute).toBe(
        resolveApiTier("/api/media/x")?.limitPerMinute
      );
    }
  });

  // /api/users/avatar/{userId} answers JSON metadata, not image bytes. Folding
  // it into the image family gave it the looser budget and, worse, an empty
  // throttle body that a JSON caller cannot parse.
  test("profile metadata routes stay on the default api tier", () => {
    for (const path of [
      "/api/users/avatar/user123",
      "/api/users/banner/user123",
      "/api/communities/avatar/cmt1",
      "/api/communities/banner/cmt1",
      "/api/users/avatar",
      "/api/link-preview",
    ]) {
      expect(resolveApiTier(path)?.bucket).toBe("api");
    }
  });

  test("the image family does not swallow deeper paths", () => {
    for (const path of [
      "/api/users/avatar/user123/image/extra",
      "/api/users/avatar/user123/metadata",
    ]) {
      expect(resolveApiTier(path)?.bucket).not.toBe("media");
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

  // A JSON error document served on an avatar URL is read by image consumers as
  // a decode failure ("Unsupported image type"), which looks like a storage bug
  // rather than a throttle.
  test("throttled image endpoints get an empty 429, never a JSON body", async () => {
    mockConsumeRateLimit.mockImplementation(() => ({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 30,
    }));

    const throttled = await Promise.all(
      [
        "/api/users/avatar/user123/image",
        "/api/media/cmt123",
        "/api/link-preview/image",
      ].map(async (path) => {
        const result = await guardApiRequest(path, "198.51.100.7");
        return {
          body: await result.response?.text(),
          contentType: result.response?.headers.get("content-type"),
          status: result.response?.status,
        };
      })
    );

    for (const response of throttled) {
      expect(response.status).toBe(429);
      expect(response.contentType).toBeNull();
      expect(response.body).toBe("");
    }
  });

  // The other half of the image/metadata split: the JSON sibling still gets a
  // JSON throttle body, so a client parsing the response does not choke.
  test("throttled profile metadata still gets a JSON body", async () => {
    mockConsumeRateLimit.mockImplementation(() => ({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 30,
    }));

    const result = await guardApiRequest(
      "/api/users/avatar/user123",
      "198.51.100.7"
    );

    expect(result.response?.status).toBe(429);
    expect(result.response?.headers.get("content-type")).toBe(
      "application/json"
    );
    expect(await result.response?.json()).toEqual({
      error: "Too many requests. Please slow down.",
    });
  });

  test("a throttled response is never cached", async () => {
    mockConsumeRateLimit.mockImplementation(() => ({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 15,
    }));

    const responses = await Promise.all(
      ["/api/tags", "/api/users/avatar/user123/image"].map((path) =>
        guardApiRequest(path, "198.51.100.7")
      )
    );

    for (const result of responses) {
      // The real bytes are served with a one-year max-age, so a stored 429
      // would outlive the window that produced it.
      expect(result.response?.headers.get("cache-control")).toBe("no-store");
    }
  });
});
