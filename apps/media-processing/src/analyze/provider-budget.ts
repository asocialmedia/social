import { redis } from "@asm/db";

import { workerEnv } from "../env";
import { isBackgroundAnalysis } from "./analysis-context";

export class ProviderBudgetDeferredError extends Error {
  readonly retryAt: number;
  constructor(provider: string, retryAt: number) {
    super(`${provider} usage budget unavailable or exhausted`);
    this.name = "ProviderBudgetDeferredError";
    this.retryAt = retryAt;
  }
}

const RESERVE = `
local limits = {tonumber(ARGV[1]), tonumber(ARGV[2])}
for period = 1, 2 do
 local total = tonumber(redis.call('GET', KEYS[period]) or '0')
 local background = tonumber(redis.call('GET', KEYS[period + 2]) or '0')
 if limits[period] > 0 and (total >= limits[period] or (ARGV[3] == '1' and background >= math.floor(limits[period] * 0.25))) then return period end
end
for period = 1, 2 do
 redis.call('INCR', KEYS[period]); redis.call('EXPIRE', KEYS[period], ARGV[period + 3])
 if ARGV[3] == '1' then redis.call('INCR', KEYS[period + 2]); redis.call('EXPIRE', KEYS[period + 2], ARGV[period + 3]) end
end
return 0
`;

export async function reserveProviderRequest(
  provider: "vision" | "gemini",
  now = new Date()
): Promise<void> {
  if (!workerEnv.PROVIDER_BUDGET_ENABLED) {
    return;
  }
  const daily =
    provider === "vision"
      ? workerEnv.VISION_DAILY_IMAGES
      : workerEnv.GEMINI_DAILY_REQUESTS;
  const monthly =
    provider === "vision"
      ? workerEnv.VISION_MONTHLY_IMAGES
      : workerEnv.GEMINI_MONTHLY_REQUESTS;
  const dayEnd = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  );
  const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const day = `media:budget:v1:${provider}:day:${now.toISOString().slice(0, 10)}`;
  const month = `media:budget:v1:${provider}:month:${now.toISOString().slice(0, 7)}`;
  let result: unknown;
  try {
    result = await redis.eval(
      RESERVE,
      4,
      day,
      month,
      `${day}:background`,
      `${month}:background`,
      daily,
      monthly,
      isBackgroundAnalysis() ? 1 : 0,
      Math.ceil((dayEnd - now.getTime()) / 1000) + 60,
      Math.ceil((monthEnd - now.getTime()) / 1000) + 60
    );
  } catch {
    throw new ProviderBudgetDeferredError(provider, now.getTime() + 60_000);
  }
  const exhausted = Number(result);
  if (exhausted !== 0) {
    throw new ProviderBudgetDeferredError(
      provider,
      (exhausted === 2 ? monthEnd : dayEnd) + 1000
    );
  }
}

export function providerBudgetSnapshot(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  return Promise.all(
    (["vision", "gemini"] as const).map(async (provider) => {
      const prefix = `media:budget:v1:${provider}`;
      const values = await redis.mget(
        `${prefix}:day:${day}`,
        `${prefix}:month:${month}`,
        `${prefix}:day:${day}:background`,
        `${prefix}:month:${month}:background`
      );
      return {
        backgroundDailyAttempts: Number(values[2] ?? 0),
        backgroundMonthlyAttempts: Number(values[3] ?? 0),
        dailyAttempts: Number(values[0] ?? 0),
        dailyLimit:
          provider === "vision"
            ? workerEnv.VISION_DAILY_IMAGES
            : workerEnv.GEMINI_DAILY_REQUESTS,
        enabled: workerEnv.PROVIDER_BUDGET_ENABLED,
        monthlyAttempts: Number(values[1] ?? 0),
        monthlyLimit:
          provider === "vision"
            ? workerEnv.VISION_MONTHLY_IMAGES
            : workerEnv.GEMINI_MONTHLY_REQUESTS,
        provider,
      };
    })
  );
}
