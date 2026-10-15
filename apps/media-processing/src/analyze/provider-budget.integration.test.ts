import { afterAll, expect, mock, test } from "bun:test";

const { redis: realRedis } = await import("@asm/db");

const namespace = `test:provider-budget:${crypto.randomUUID()}:`;
let unavailable = false;
const settings = {
  GEMINI_DAILY_REQUESTS: 4,
  GEMINI_MONTHLY_REQUESTS: 6,
  PROVIDER_BUDGET_ENABLED: true,
  VISION_DAILY_IMAGES: 4,
  VISION_MONTHLY_IMAGES: 6,
};
mock.module("../env", () => ({ workerEnv: settings }));
mock.module("@asm/db", () => ({
  redis: {
    eval: (
      script: string,
      count: number,
      ...arguments_: (string | number)[]
    ) => {
      if (unavailable) {
        return Promise.reject(new Error("Redis unavailable"));
      }
      return realRedis.eval(
        script,
        count,
        ...arguments_.map((value, index) =>
          index < count ? `${namespace}${value}` : value
        )
      );
    },
  },
}));
const { reserveProviderRequest, ProviderBudgetDeferredError } =
  await import("./provider-budget");
const { withAnalysisLane } = await import("./analysis-context");
afterAll(async () => {
  const keys = await realRedis.keys(`${namespace}*`);
  if (keys.length) {
    await realRedis.del(...keys);
  }
  realRedis.disconnect();
});

test("atomic caps reserve fresh capacity and separate daily from monthly limits", async () => {
  const now = new Date();
  await withAnalysisLane(true, () => reserveProviderRequest("vision", now));
  await expect(
    withAnalysisLane(true, () => reserveProviderRequest("vision", now))
  ).rejects.toBeInstanceOf(ProviderBudgetDeferredError);
  const fresh = await Promise.allSettled(
    Array.from({ length: 10 }, () => reserveProviderRequest("vision", now))
  );
  expect(fresh.filter((result) => result.status === "fulfilled")).toHaveLength(
    3
  );
  const tomorrow = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  // Stay inside the same month for the monthly-boundary assertion.
  if (tomorrow.getUTCMonth() === now.getUTCMonth()) {
    await reserveProviderRequest("vision", tomorrow);
    await reserveProviderRequest("vision", tomorrow);
    await expect(
      reserveProviderRequest("vision", tomorrow)
    ).rejects.toBeInstanceOf(ProviderBudgetDeferredError);
  }
  unavailable = true;
  await expect(reserveProviderRequest("gemini", now)).rejects.toBeInstanceOf(
    ProviderBudgetDeferredError
  );
});
