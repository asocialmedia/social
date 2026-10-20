import { expect, test } from "bun:test";

import { redis } from "@asm/db";

import {
  consumeExternalCreationBudget,
  consumeProtocolBudget,
  ProtocolBudgetError,
} from "./budget";

test("a normal guest burst is allowed and concurrent abuse cannot bypass the shared budget", async () => {
  const identity = `test-${crypto.randomUUID()}`;
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, () =>
        consumeProtocolBudget(identity, "read", false, "guest")
      )
    );
    const accepted = results.filter((result) => result.status === "fulfilled");
    expect(accepted.length).toBeGreaterThanOrEqual(30);
    expect(accepted.length).toBeLessThanOrEqual(31);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(ProtocolBudgetError);
      }
    }
    await consumeProtocolBudget(`${identity}-neighbor`, "read", false, "guest");
  } finally {
    await redis.del(
      `ratelimit:protocols:read:guest:${identity}`,
      `ratelimit:protocols:read:guest:${identity}-neighbor`
    );
  }
});

test("daily retention quotas block storage abuse while keeping the normal write budget independent", async () => {
  const userId = `test-${crypto.randomUUID()}`;
  const key = `ratelimit:protocols:retention:${userId}`;
  try {
    await consumeExternalCreationBudget(userId);
    expect(await redis.hget(key, "count")).toBe("1");
    await redis.hset(key, "count", 1000);
    await expect(consumeExternalCreationBudget(userId)).rejects.toBeInstanceOf(
      ProtocolBudgetError
    );
    await consumeProtocolBudget(userId, "feedback", true);
  } finally {
    await redis.del(key, `ratelimit:protocols:feedback:account:${userId}`);
  }
});
