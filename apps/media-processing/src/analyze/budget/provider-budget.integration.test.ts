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
mock.module("../../env", () => ({ workerEnv: settings }));
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
const { withAnalysisLane } = await import("../state/analysis-context");
afterAll(async () => {
  const keys = await realRedis.keys(`${namespace}*`);
  if (keys.length) {
    await realRedis.del(...keys);
  }
  realRedis.disconnect();
});

test("atomic caps reserve fresh capacity and separate daily from monthly limits", async () => {
  const now = new Date();
  await withAnalysisLane(true, () => reserveProviderRequest("gemini", now));
  await expect(
    withAnalysisLane(true, () => reserveProviderRequest("gemini", now))
  ).rejects.toBeInstanceOf(ProviderBudgetDeferredError);
  const fresh = await Promise.allSettled(
    Array.from({ length: 10 }, () => reserveProviderRequest("gemini", now))
  );
  expect(fresh.filter((result) => result.status === "fulfilled")).toHaveLength(
    3
  );
  const tomorrow = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  // Stay inside the same month for the monthly-boundary assertion.
  if (tomorrow.getUTCMonth() === now.getUTCMonth()) {
    await reserveProviderRequest("gemini", tomorrow);
    await reserveProviderRequest("gemini", tomorrow);
    await expect(
      reserveProviderRequest("gemini", tomorrow)
    ).rejects.toBeInstanceOf(ProviderBudgetDeferredError);
  }
  unavailable = true;
  await expect(reserveProviderRequest("gemini", now)).rejects.toBeInstanceOf(
    ProviderBudgetDeferredError
  );
});

test("Vision backfills allow 50 daily and 550 monthly while respecting shared totals", async () => {
  unavailable = false;
  settings.VISION_DAILY_IMAGES = 100;
  settings.VISION_MONTHLY_IMAGES = 900;
  const firstDay = new Date("2099-06-01T12:00:00Z");
  await Promise.all(
    Array.from({ length: 50 }, () =>
      withAnalysisLane(true, () => reserveProviderRequest("vision", firstDay))
    )
  );
  await expect(
    withAnalysisLane(true, () => reserveProviderRequest("vision", firstDay))
  ).rejects.toMatchObject({ limit: 50, reason: "daily-background", used: 50 });
  await Promise.all(
    Array.from({ length: 50 }, () => reserveProviderRequest("vision", firstDay))
  );
  await expect(
    reserveProviderRequest("vision", firstDay)
  ).rejects.toMatchObject({ limit: 100, reason: "daily-total", used: 100 });
  await Promise.all(
    Array.from({ length: 10 }, (_, index) => {
      const day = new Date(Date.UTC(2099, 5, index + 2, 12));
      return Promise.all(
        Array.from({ length: 50 }, () =>
          withAnalysisLane(true, () => reserveProviderRequest("vision", day))
        )
      );
    })
  );
  const nextDay = new Date("2099-06-12T12:00:00Z");
  await expect(
    withAnalysisLane(true, () => reserveProviderRequest("vision", nextDay))
  ).rejects.toMatchObject({
    limit: 550,
    reason: "monthly-background",
    used: 550,
  });
  await reserveProviderRequest("vision", nextDay);
});

test("reports the exact worker cap and UTC reset rather than implying a Google quota error", async () => {
  unavailable = false;
  const now = new Date("2099-02-10T19:00:00Z");
  await withAnalysisLane(true, () => reserveProviderRequest("gemini", now));
  await expect(
    withAnalysisLane(true, () => reserveProviderRequest("gemini", now))
  ).rejects.toMatchObject({
    limit: 1,
    provider: "gemini",
    reason: "daily-background",
    retryAt: Date.parse("2099-02-11T00:00:01Z"),
    used: 1,
  });
  await Promise.all(
    Array.from({ length: 3 }, () => reserveProviderRequest("gemini", now))
  );
  await expect(reserveProviderRequest("gemini", now)).rejects.toMatchObject({
    limit: 4,
    reason: "daily-total",
    used: 4,
  });
  const tomorrow = new Date("2099-02-11T19:00:00Z");
  await expect(
    withAnalysisLane(true, () => reserveProviderRequest("gemini", tomorrow))
  ).rejects.toMatchObject({
    reason: "monthly-background",
    retryAt: Date.parse("2099-03-01T00:00:01Z"),
  });
  await reserveProviderRequest("gemini", tomorrow);
  await reserveProviderRequest("gemini", tomorrow);
  await expect(
    reserveProviderRequest("gemini", tomorrow)
  ).rejects.toMatchObject({ limit: 6, reason: "monthly-total", used: 6 });
  unavailable = true;
  await expect(
    reserveProviderRequest("gemini", tomorrow)
  ).rejects.toMatchObject({ reason: "storage-unavailable" });
});
