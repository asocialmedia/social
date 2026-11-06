import { redis } from "@asm/db";

import { workerEnv } from "../../env";
import { isBackgroundAnalysis } from "../state/analysis-context";

export class ProviderBudgetDeferredError extends Error {
  readonly retryAt: number;
  readonly provider: string;
  readonly reason:
    | "daily-total"
    | "daily-background"
    | "monthly-total"
    | "monthly-background"
    | "storage-unavailable";
  readonly used: number | undefined;
  readonly limit: number | undefined;
  constructor(
    provider: string,
    retryAt: number,
    reason:
      | "daily-total"
      | "daily-background"
      | "monthly-total"
      | "monthly-background"
      | "storage-unavailable" = "storage-unavailable",
    used?: number,
    limit?: number
  ) {
    super(
      `${provider} worker budget deferred: ${reason}${used !== undefined && limit !== undefined ? ` (${used}/${limit} requests)` : ""}`
    );
    this.name = "ProviderBudgetDeferredError";
    this.retryAt = retryAt;
    this.provider = provider;
    this.reason = reason;
    this.used = used;
    this.limit = limit;
  }
}

const RESERVE = `
local limits = {tonumber(ARGV[1]), tonumber(ARGV[2])}
local background_limits = {tonumber(ARGV[6]), tonumber(ARGV[7])}
for period = 1, 2 do
 local total = tonumber(redis.call('GET', KEYS[period]) or '0')
 local background = tonumber(redis.call('GET', KEYS[period + 2]) or '0')
 if limits[period] > 0 then
  if total >= limits[period] then return {period, 0, total, limits[period]} end
  local background_limit = background_limits[period]
  if ARGV[3] == '1' and background >= background_limit then return {period, 1, background, background_limit} end
 end
end
for period = 1, 2 do
 redis.call('INCR', KEYS[period]); redis.call('EXPIRE', KEYS[period], ARGV[period + 3])
 if ARGV[3] == '1' then redis.call('INCR', KEYS[period + 2]); redis.call('EXPIRE', KEYS[period + 2], ARGV[period + 3]) end
end
return {0}
`;

function backgroundLimits(
  provider: "vision" | "gemini",
  daily: number,
  monthly: number
) {
  if (provider === "vision") {
    return { daily: Math.min(daily, 50), monthly: Math.min(monthly, 550) };
  }
  return {
    daily: Math.max(1, Math.floor(daily * 0.25)),
    monthly: Math.max(1, Math.floor(monthly * 0.25)),
  };
}

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
  const background = backgroundLimits(provider, daily, monthly);
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
      Math.ceil((monthEnd - now.getTime()) / 1000) + 60,
      background.daily,
      background.monthly
    );
  } catch {
    throw new ProviderBudgetDeferredError(provider, now.getTime() + 60_000);
  }
  if (!Array.isArray(result) || ![0, 1, 2].includes(Number(result[0]))) {
    throw new ProviderBudgetDeferredError(provider, now.getTime() + 60_000);
  }
  const exhausted = Number(result[0]);
  if (exhausted !== 0) {
    const isBackgroundLimit = Number(result[1]) === 1;
    const period = exhausted === 2 ? "monthly" : "daily";
    const reason =
      `${period}-${isBackgroundLimit ? "background" : "total"}` as const;
    throw new ProviderBudgetDeferredError(
      provider,
      (exhausted === 2 ? monthEnd : dayEnd) + 1000,
      reason,
      Number(result[2]),
      Number(result[3])
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
      const dailyLimit =
        provider === "vision"
          ? workerEnv.VISION_DAILY_IMAGES
          : workerEnv.GEMINI_DAILY_REQUESTS;
      const monthlyLimit =
        provider === "vision"
          ? workerEnv.VISION_MONTHLY_IMAGES
          : workerEnv.GEMINI_MONTHLY_REQUESTS;
      const background = backgroundLimits(provider, dailyLimit, monthlyLimit);
      return {
        backgroundDailyAttempts: Number(values[2] ?? 0),
        backgroundDailyLimit: background.daily,
        backgroundMonthlyAttempts: Number(values[3] ?? 0),
        backgroundMonthlyLimit: background.monthly,
        dailyAttempts: Number(values[0] ?? 0),
        dailyLimit,
        enabled: workerEnv.PROVIDER_BUDGET_ENABLED,
        monthlyAttempts: Number(values[1] ?? 0),
        monthlyLimit,
        provider,
      };
    })
  );
}
