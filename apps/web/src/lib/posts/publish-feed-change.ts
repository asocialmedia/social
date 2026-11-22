import { redis } from "@asm/db";
import {
  feedAuthorityKeys,
  FEED_EVENTS_CHANNEL,
} from "@asm/protocols/discovery";

export async function publishFeedChange(publishedAt?: number) {
  try {
    await Promise.all([
      redis.publish(FEED_EVENTS_CHANNEL, JSON.stringify({ source: "asm" })),
      publishedAt
        ? redis.eval(
            "if tonumber(redis.call('GET', KEYS[1]) or '0') < tonumber(ARGV[1]) then return redis.call('SET', KEYS[1], ARGV[1], 'EX', 2592000) end return 0",
            1,
            feedAuthorityKeys.native,
            publishedAt
          )
        : null,
    ]);
  } catch {
    // A committed write succeeds even if realtime delivery is temporarily unavailable.
  }
}
