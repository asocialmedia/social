import { beforeEach, describe, expect, mock, test } from "bun:test";

const mockRedisGet = mock((_key: string): Promise<string | null> =>
  Promise.resolve(null)
);

mock.module("@asm/db", () => ({
  redis: { get: mockRedisGet },
}));

const { GET } = await import("./route");

describe("health route", () => {
  beforeEach(() => {
    mockRedisGet.mockReset();
    mockRedisGet.mockImplementation(() => Promise.resolve(null));
  });

  test("reports the dedicated message-search worker separately", async () => {
    const now = Date.now();
    mockRedisGet.mockImplementation((key) =>
      Promise.resolve(
        key === "worker:heartbeat" || key === "worker:message-search:heartbeat"
          ? String(now)
          : null
      )
    );

    const response = await GET();
    const body = await response.json();

    expect(body.worker).toBe("healthy");
    expect(body.messageSearchWorker).toBe("healthy");
  });

  test("reports a stale message-search worker without masking the general worker", async () => {
    const now = Date.now();
    mockRedisGet.mockImplementation((key) =>
      Promise.resolve(
        key === "worker:heartbeat" ? String(now) : String(now - 30_000)
      )
    );

    const response = await GET();
    const body = await response.json();

    expect(body.worker).toBe("healthy");
    expect(body.messageSearchWorker).toBe("unhealthy");
  });

  test("keeps an absent or unreadable worker heartbeat unknown", async () => {
    mockRedisGet.mockImplementation((key) =>
      key === "worker:heartbeat"
        ? Promise.resolve("not-a-timestamp")
        : Promise.reject(new Error("Redis unavailable"))
    );

    const response = await GET();
    const body = await response.json();

    expect(body.worker).toBe("unhealthy");
    expect(body.messageSearchWorker).toBe("unknown");
    expect(body.status).toBe("healthy");
  });
});
