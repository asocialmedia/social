import type { ExternalPost } from "@asm/protocols/contracts";
import { externalPostSchema } from "@asm/protocols/discovery";
import type Redis from "ioredis";

// Redis bounds both the number and serialized bytes of public, temporary snapshots.
// A raw stream record never enters this inventory before AppView and author-policy validation.
const retentionMs = 120_000;
const inventoryScript = `
local now = tonumber(ARGV[2])
local function remove(id)
  local size = tonumber(redis.call('HGET', KEYS[3], id) or '0')
  redis.call('HDEL', KEYS[1], id)
  redis.call('ZREM', KEYS[2], id)
  redis.call('HDEL', KEYS[3], id)
  if size > 0 then redis.call('INCRBY', KEYS[4], -size) end
end
local function invalidated(id)
  local author = string.match(id, '^at://([^/]+)/') or ''
  return math.max(tonumber(redis.call('HGET', KEYS[5], id) or '0'), tonumber(redis.call('HGET', KEYS[5], author) or '0'))
end
if ARGV[1] == 'invalidate' then
  redis.call('HSET', KEYS[5], ARGV[3], now)
  redis.call('ZADD', KEYS[6], now, ARGV[3])
  for _, id in ipairs(redis.call('ZRANGEBYSCORE', KEYS[6], '-inf', now - 900000)) do
    redis.call('ZREM', KEYS[6], id); redis.call('HDEL', KEYS[5], id)
  end
  for _, id in ipairs(redis.call('ZRANGE', KEYS[6], 0, -8193)) do
    redis.call('ZREM', KEYS[6], id); redis.call('HDEL', KEYS[5], id)
  end
  redis.call('PEXPIRE', KEYS[5], 900000); redis.call('PEXPIRE', KEYS[6], 900000)
  return 1
end
if ARGV[1] == 'put' then
  for _, id in ipairs(redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now - ${retentionMs})) do remove(id) end
  local started = tonumber(ARGV[3])
  for index = 4, #ARGV, 2 do
    local id, value = ARGV[index], ARGV[index + 1]
    local bytes = string.len(id) + string.len(value)
    if bytes <= 32768 and invalidated(id) < started then
      remove(id)
      redis.call('HSET', KEYS[1], id, value)
      redis.call('ZADD', KEYS[2], started, id)
      redis.call('HSET', KEYS[3], id, bytes)
      redis.call('INCRBY', KEYS[4], bytes)
    end
  end
  while redis.call('ZCARD', KEYS[2]) > 2000 or tonumber(redis.call('GET', KEYS[4]) or '0') > 25165824 do
    local oldest = redis.call('ZRANGE', KEYS[2], 0, 0)[1]
    if not oldest then break end
    remove(oldest)
  end
  for index = 1, 4 do redis.call('PEXPIRE', KEYS[index], ${retentionMs * 2}) end
  return 1
end
local ids = {}
if #ARGV > 2 then
  for index = 3, #ARGV do ids[#ids + 1] = ARGV[index] end
else
  ids = redis.call('ZREVRANGEBYSCORE', KEYS[2], '+inf', now - ${retentionMs}, 'LIMIT', 0, 2000)
end
local result = {}
for _, id in ipairs(ids) do
  local at = tonumber(redis.call('ZSCORE', KEYS[2], id) or '0')
  if at > now - ${retentionMs} and at > invalidated(id) then
    local value = redis.call('HGET', KEYS[1], id)
    if value then result[#result + 1] = value end
  end
end
return result
`;

export interface InventoryStore {
  read: (ids?: string[]) => Promise<ExternalPost[]>;
  put: (posts: ExternalPost[], startedAt: number) => Promise<void>;
  invalidate: (target: string) => Promise<void>;
}

export class RedisInventoryStore implements InventoryStore {
  private readonly keys: string[];
  private readonly redis: Pick<Redis, "eval">;
  constructor(
    redis: Pick<Redis, "eval">,
    scope = "asm:protocols:{inventory:v2}"
  ) {
    this.redis = redis;
    this.keys = [
      "posts",
      "time",
      "sizes",
      "bytes",
      "invalidated",
      "invalidated-time",
    ].map((suffix) => `${scope}:${suffix}`);
  }
  async read(ids?: string[]) {
    const raw = await this.redis.eval(
      inventoryScript,
      this.keys.length,
      ...this.keys,
      "read",
      Date.now(),
      ...(ids ?? [])
    );
    return Array.isArray(raw)
      ? raw.flatMap((value: unknown) => {
          if (typeof value !== "string") {
            return [];
          }
          try {
            const parsed = externalPostSchema.safeParse(JSON.parse(value));
            return parsed.success ? [parsed.data] : [];
          } catch {
            return [];
          }
        })
      : [];
  }
  async put(posts: ExternalPost[], startedAt: number) {
    if (!posts.length) {
      return;
    }
    await this.redis.eval(
      inventoryScript,
      this.keys.length,
      ...this.keys,
      "put",
      Date.now(),
      startedAt,
      ...posts.slice(0, 50).flatMap((post) => [post.id, JSON.stringify(post)])
    );
  }
  async invalidate(target: string) {
    await this.redis.eval(
      inventoryScript,
      this.keys.length,
      ...this.keys,
      "invalidate",
      Date.now(),
      target
    );
  }
}
