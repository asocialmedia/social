import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

const mockGetSession = mock(() => Promise.resolve({ user: { id: "user-1" } }));
const mockRateLimit = mock(() =>
  Promise.resolve({
    allowed: true,
    remaining: 29,
    resetAt: 0,
    retryAfterSeconds: 0,
  })
);
const mockRecordMetrics = mock(() => {});

mock.module("@asm/db", () => ({ consumeRateLimit: mockRateLimit }));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));
mock.module("@/lib/messages/search-client-metrics", () => ({
  recordMessageSearchClientMetrics: mockRecordMetrics,
}));

function request(body: unknown, headers: HeadersInit = {}): Request {
  return new Request("http://localhost/api/messages/search/telemetry", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
    method: "POST",
  });
}

describe("POST /api/messages/search/telemetry", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    mockRateLimit.mockReset();
    mockRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 29,
      resetAt: 0,
      retryAfterSeconds: 0,
    });
    mockRecordMetrics.mockClear();
  });

  test("accepts a privacy-safe batch", async () => {
    const response = await POST(
      request({
        events: [
          { durationMs: 18, event: "input-paint" },
          { durationMs: 240, event: "result-ready", outcome: "hits" },
        ],
      })
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 2 });
    expect(mockRecordMetrics).toHaveBeenCalledTimes(1);
    expect(mockRateLimit).toHaveBeenCalledWith({
      bucket: "message-search-telemetry",
      identifier: "user-1",
      limit: 30,
      windowSeconds: 60,
    });
  });

  test("rejects queries and identifiers before recording", async () => {
    const response = await POST(
      request({
        events: [
          {
            conversationId: "secret-conversation",
            durationMs: 18,
            event: "input-paint",
            query: "private search",
          },
        ],
      })
    );

    expect(response.status).toBe(400);
    expect(mockRecordMetrics).not.toHaveBeenCalled();
  });

  test("rejects unauthenticated and rate-limited requests", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const unauthorized = await POST(
      request({ events: [{ durationMs: 1, event: "long-task" }] })
    );
    expect(unauthorized.status).toBe(401);

    mockRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: 0,
      retryAfterSeconds: 20,
    });
    const limited = await POST(
      request({ events: [{ durationMs: 1, event: "long-task" }] })
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("20");
    expect(mockRecordMetrics).not.toHaveBeenCalled();
  });

  test("degrades cleanly when telemetry rate limiting is unavailable", async () => {
    mockRateLimit.mockRejectedValueOnce(new Error("redis unavailable"));

    const response = await POST(
      request({ events: [{ durationMs: 1, event: "long-task" }] })
    );

    expect(response.status).toBe(503);
    expect(mockRecordMetrics).not.toHaveBeenCalled();
  });

  test("enforces the request byte limit before parsing", async () => {
    const response = await POST(
      request(
        { events: [{ durationMs: 1, event: "long-task" }] },
        {
          "Content-Length": "4097",
        }
      )
    );

    expect(response.status).toBe(413);
    expect(mockRecordMetrics).not.toHaveBeenCalled();
  });

  test("bounds streaming bodies without a content-length header", async () => {
    const response = await POST(
      request({
        events: [
          {
            durationMs: 1,
            event: "long-task",
            padding: "x".repeat(5000),
          },
        ],
      })
    );

    expect(response.status).toBe(413);
    expect(mockRecordMetrics).not.toHaveBeenCalled();
  });
});
