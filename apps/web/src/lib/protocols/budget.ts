import { redis } from "@asm/db";

export class ProtocolBudgetError extends Error {
  readonly retryAfter: number;
  constructor(retryAfter: number) {
    super("rate_limited");
    this.name = "ProtocolBudgetError";
    this.retryAfter = retryAfter;
  }
}

const budgetScript = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local interval = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2]) * interval
local next = math.max(now, tonumber(redis.call('GET', KEYS[1]) or now)) + interval
if next - now > capacity then return math.ceil((next - now - capacity) / 1000) end
redis.call('SET', KEYS[1], next, 'PX', math.ceil(capacity * 2))
return 0
`;
export async function consumeProtocolBudget(
  identity: string,
  kind: "read" | "feedback",
  account = false,
  audience?: "guest" | "global"
): Promise<void> {
  let limits = { feedback: [600, 100], read: [6000, 600] };
  if (account) {
    limits = { feedback: [30, 10], read: [120, 20] };
  }
  if (audience === "guest") {
    limits = { feedback: [30, 10], read: [120, 30] };
  }
  if (audience === "global") {
    limits = { feedback: [6000, 200], read: [60_000, 2000] };
  }
  const [limit = 1, burst = 1] = limits[kind];
  const wait = await redis.eval(
    budgetScript,
    1,
    `ratelimit:protocols:${kind}:${audience ?? (account ? "account" : "ingress")}:${identity}`,
    60_000 / limit,
    burst
  );
  if (Number(wait) > 0) {
    throw new ProtocolBudgetError(Number(wait));
  }
}

export async function consumeExternalCreationBudget(
  userId: string
): Promise<void> {
  const wait = await redis.eval(
    `
local now = tonumber(redis.call('TIME')[1])
local day = math.floor(now / 86400)
local count = redis.call('HGET', KEYS[1], 'day') == tostring(day) and tonumber(redis.call('HGET', KEYS[1], 'count') or '0') or 0
if count >= 1000 then return 86400 - now % 86400 end
redis.call('HSET', KEYS[1], 'day', day, 'count', count + 1)
redis.call('EXPIRE', KEYS[1], 172800)
return 0
`,
    1,
    `ratelimit:protocols:retention:${userId}`
  );
  if (Number(wait) > 0) {
    throw new ProtocolBudgetError(Number(wait));
  }
}
