import { redis } from "../src/redis";

const SHARE_STATS_PREFIX = "share:stats:";
const SHARE_CLICKS_PREFIX = "share:clicks:";

// Atomically claims the viewer dedupe key and increments the click counter in
// one script, so a duplicate claim can never race an increment (no double-count
// window). KEYS[1] = dedupe key, KEYS[2] = the click counter. Returns a
// multi-bulk { claimed, clicks } where claimed is 0 when the viewer already
// claimed inside the window and clicks is the current counter.
const CLAIM_AND_INCREMENT_CLICK_SCRIPT = `
local ok = redis.call("SET", KEYS[1], "1", "EX", tonumber(ARGV[1]), "NX")
if not ok then
  local current = redis.call("GET", KEYS[2])
  if current then return { 0, tonumber(current) } end
  return { 0, 0 }
end
local clicks = redis.call("INCR", KEYS[2])
redis.call("EXPIRE", KEYS[2], 86400)
return { 1, clicks }
`;

export const shareStatsCache = {
  // One-shot click claim for exactly-once semantics: claims `dedupeKey` inside
  // the TTL and increments the counter atomically. Fails open (claimed=true)
  // when Redis is unreachable so real clicks are never dropped.
  async claimAndIncrementClick(
    postId: string,
    platform: string,
    dedupeKey: string,
    ttlSeconds: number
  ): Promise<{ claimed: boolean; clicks: number }> {
    try {
      const clicksKey = `${SHARE_CLICKS_PREFIX}${postId}:${platform}`;
      const result = (await redis.eval(
        CLAIM_AND_INCREMENT_CLICK_SCRIPT,
        2,
        dedupeKey,
        clicksKey,
        ttlSeconds
      )) as [number, number];
      return { claimed: result[0] === 1, clicks: result[1] };
    } catch (error) {
      console.error("Error claiming and incrementing click count:", error);
      return { claimed: true, clicks: 0 };
    }
  },

  // Same exactly-once pattern for shares: claims `dedupeKey` inside the TTL
  // and increments the share counter atomically, so a duplicate claim can
  // never double-count. Fails open when Redis is unreachable.
  async claimAndIncrementShare(
    postId: string,
    platform: string,
    dedupeKey: string,
    ttlSeconds: number
  ): Promise<{ claimed: boolean; shares: number }> {
    try {
      const sharesKey = `${SHARE_STATS_PREFIX}${postId}:${platform}`;
      const result = (await redis.eval(
        CLAIM_AND_INCREMENT_CLICK_SCRIPT,
        2,
        dedupeKey,
        sharesKey,
        ttlSeconds
      )) as [number, number];
      return { claimed: result[0] === 1, shares: result[1] };
    } catch (error) {
      console.error("Error claiming and incrementing share count:", error);
      return { claimed: true, shares: 0 };
    }
  },

  async getClicks(postId: string, platform: string): Promise<number> {
    try {
      const clicks = await redis.get(
        `${SHARE_CLICKS_PREFIX}${postId}:${platform}`
      );
      return Math.trunc(Number(clicks || "0"));
    } catch (error) {
      console.error("Error getting click count:", error);
      return 0;
    }
  },

  async getStats(
    postId: string,
    platform: string
  ): Promise<{ shares: number; clicks: number }> {
    try {
      const pipeline = redis.pipeline();
      pipeline.get(`${SHARE_STATS_PREFIX}${postId}:${platform}`);
      pipeline.get(`${SHARE_CLICKS_PREFIX}${postId}:${platform}`);
      const results = await pipeline.exec();

      return {
        clicks: Math.trunc(Number((results?.[1]?.[1] as string) || "0")),
        shares: Math.trunc(Number((results?.[0]?.[1] as string) || "0")),
      };
    } catch (error) {
      console.error("Error getting share stats:", error);
      return { clicks: 0, shares: 0 };
    }
  },

  async incrementClick(postId: string, platform: string): Promise<number> {
    try {
      const key = `${SHARE_CLICKS_PREFIX}${postId}:${platform}`;
      const result = await redis.incr(key);
      await redis.expire(key, 86_400);
      return result;
    } catch (error) {
      console.error("Error incrementing click count:", error);
      return 0;
    }
  },

  async incrementShare(postId: string, platform: string): Promise<number> {
    try {
      const key = `${SHARE_STATS_PREFIX}${postId}:${platform}`;
      const result = await redis.incr(key);
      await redis.expire(key, 86_400);
      return result;
    } catch (error) {
      console.error("Error incrementing share count:", error);
      return 0;
    }
  },
};
