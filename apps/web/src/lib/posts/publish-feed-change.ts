import { redis } from "@asm/db";
import { FEED_EVENTS_CHANNEL } from "@asm/protocols/discovery";

export async function publishFeedChange() {
  try {
    await redis.publish(FEED_EVENTS_CHANNEL, JSON.stringify({ source: "asm" }));
  } catch {
    // A committed write succeeds even if realtime delivery is temporarily unavailable.
  }
}
