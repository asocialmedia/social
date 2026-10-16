import type Redis from "ioredis";

export interface DiscoveryLease {
  key: string;
  owner: string;
}

export interface DiscoveryStore {
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    ttlMs: number,
    lease?: DiscoveryLease
  ) => Promise<boolean>;
  acquire: (key: string, owner: string) => Promise<boolean>;
  release: (key: string, owner: string) => Promise<void>;
}

export { MemoryDiscoveryStore } from "./discovery-memory-store";

const prelude = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local function remove(field)
  local size = tonumber(redis.call('HGET', KEYS[2], field) or '0')
  redis.call('HDEL', KEYS[1], field)
  redis.call('HDEL', KEYS[2], field)
  redis.call('ZREM', KEYS[3], field)
  redis.call('ZREM', KEYS[4], field)
  if size > 0 then redis.call('INCRBY', KEYS[5], -size) end
end
`;
const getScript = `${prelude}
local expiry = tonumber(redis.call('ZSCORE', KEYS[3], ARGV[1]) or '0')
if expiry <= now then remove(ARGV[1]); return false end
local value = redis.call('HGET', KEYS[1], ARGV[1])
if value then redis.call('ZADD', KEYS[4], now, ARGV[1]) end
return value
`;
const setScript = `${prelude}
if ARGV[7] ~= '' and redis.call('GET', KEYS[6]) ~= ARGV[7] then return 0 end
local bytes = tonumber(ARGV[3])
local maxBytes = tonumber(ARGV[4])
local maxEntries = tonumber(ARGV[5])
if bytes > maxBytes then return 0 end
for _, field in ipairs(redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now)) do remove(field) end
remove(ARGV[1])
while redis.call('HLEN', KEYS[1]) >= maxEntries or tonumber(redis.call('GET', KEYS[5]) or '0') + bytes > maxBytes do
  local oldest = redis.call('ZRANGE', KEYS[4], 0, 0)[1]
  if not oldest then return 0 end
  remove(oldest)
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('HSET', KEYS[2], ARGV[1], bytes)
redis.call('ZADD', KEYS[3], now + tonumber(ARGV[6]), ARGV[1])
redis.call('ZADD', KEYS[4], now, ARGV[1])
redis.call('INCRBY', KEYS[5], bytes)
for index = 1, 5 do redis.call('PEXPIRE', KEYS[index], 1200000) end
return 1
`;
const releaseScript =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

export class RedisDiscoveryStore implements DiscoveryStore {
  private readonly redis: Pick<Redis, "eval" | "set">;
  private readonly keys: string[];
  private readonly scope: string;
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  constructor(
    redis: Pick<Redis, "eval" | "set">,
    options: { scope?: string; maxBytes?: number; maxEntries?: number } = {}
  ) {
    this.redis = redis;
    this.scope = options.scope ?? "asm:protocols:{discovery:v1}";
    this.keys = ["data", "sizes", "expiry", "lru", "bytes"].map(
      (suffix) => `${this.scope}:${suffix}`
    );
    this.maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
    this.maxEntries = options.maxEntries ?? 512;
    if (
      ![this.maxBytes, this.maxEntries].every(
        (value) => Number.isSafeInteger(value) && value > 0
      )
    ) {
      throw new RangeError("Invalid discovery cache capacity");
    }
  }
  async get(key: string): Promise<string | null> {
    const result = await this.redis.eval(
      getScript,
      this.keys.length,
      ...this.keys,
      key
    );
    return typeof result === "string" ? result : null;
  }
  async set(
    key: string,
    value: string,
    ttlMs: number,
    lease?: DiscoveryLease
  ): Promise<boolean> {
    if (
      !Number.isInteger(ttlMs) ||
      ttlMs < 1 ||
      ttlMs > 900_000 ||
      Buffer.byteLength(value) > 512 * 1024
    ) {
      return false;
    }
    return (
      (await this.redis.eval(
        setScript,
        this.keys.length + 1,
        ...this.keys,
        `${this.scope}:lock:${lease?.key ?? "unused"}`,
        key,
        value,
        Buffer.byteLength(key + value),
        this.maxBytes,
        this.maxEntries,
        ttlMs,
        lease?.owner ?? ""
      )) === 1
    );
  }
  async acquire(key: string, owner: string): Promise<boolean> {
    return (
      (await this.redis.set(
        `${this.scope}:lock:${key}`,
        owner,
        "PX",
        30_000,
        "NX"
      )) === "OK"
    );
  }
  async release(key: string, owner: string): Promise<void> {
    await this.redis.eval(releaseScript, 1, `${this.scope}:lock:${key}`, owner);
  }
}
