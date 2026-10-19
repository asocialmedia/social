import { afterAll, expect, mock, test } from "bun:test";

import { redis } from "@asm/db";

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(null),
}));
const original = process.env.PROTOCOLS_GUEST_SECRET;
process.env.PROTOCOLS_GUEST_SECRET = crypto.randomUUID() + crypto.randomUUID();
afterAll(() => {
  if (original === undefined) {
    delete process.env.PROTOCOLS_GUEST_SECRET;
  } else {
    process.env.PROTOCOLS_GUEST_SECRET = original;
  }
});
const { guestSearchBudget } = await import("./guest-budget");

test("Redis atomically limits both search sources and rejects bursts without charging refused hits", async () => {
  const first = await guestSearchBudget(
    new Request("http://localhost/api/search/spotlight?q=software")
  );
  const cookie = first.headers.get("set-cookie")?.split(";")[0] ?? "";
  const identity = cookie.split("=")[1]?.split(".")[0];
  if (!identity) {
    throw new Error("Missing signed search guest identity");
  }
  const minuteKey = `ratelimit:search:{${identity}}:minute`;
  const burstKey = `ratelimit:search:{${identity}}:burst`;
  try {
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        guestSearchBudget(
          new Request(
            `http://localhost/api/${index % 2 ? "search/spotlight" : "protocols/bluesky/search"}?q=software`,
            { headers: { cookie } }
          )
        )
      )
    );
    expect(results.filter((result) => result.response === null)).toHaveLength(
      23
    );
    expect(
      results.filter((result) => result.response?.status === 429)
    ).toHaveLength(17);
    expect(await redis.zcard(minuteKey)).toBe(24);
    expect(await redis.zcard(burstKey)).toBe(24);
    expect(
      Number(
        results.find((result) => result.response)?.headers.get("retry-after")
      )
    ).toBeGreaterThan(0);
    await redis.del(burstKey);
    const now = Date.now();
    const pipeline = redis.pipeline();
    for (let index = 0; index < 36; index += 1) {
      pipeline.zadd(minuteKey, now, `fixture-${index}`);
    }
    await pipeline.exec();
    const denied = await guestSearchBudget(
      new Request("http://localhost/api/search/spotlight?q=software", {
        headers: { cookie },
      })
    );
    expect(denied.response?.status).toBe(429);
    expect(await redis.zcard(minuteKey)).toBe(60);
    expect(await redis.exists(burstKey)).toBe(0);
  } finally {
    await redis.del(minuteKey, burstKey);
  }
});
