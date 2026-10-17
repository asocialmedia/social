import { z } from "zod";

export const FEED_EVENTS_CHANNEL = "asm:feeds:changes:v1";
export const DISCOVERY_WATCH_CHANNEL = "asm:protocols:discovery:watch:v1";
export const PROTOCOL_INVALIDATIONS_CHANNEL = "asm:protocols:invalidations";

export const feedChangeSchema = z.object({
  locale: z.string().max(8).optional(),
  mode: z.enum(["latest", "personalized", "trending"]).optional(),
  source: z.enum(["asm", "bluesky", "connected"]),
});
export type FeedChange = z.infer<typeof feedChangeSchema>;

// A burst schedules one read; arrivals during that read schedule one follow-up.
export function createFeedReadScheduler(
  read: () => Promise<unknown>,
  delayMs = 1500
) {
  let stopped = false;
  let running = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (stopped) {
      return;
    }
    dirty = true;
    if (running || timer) {
      return;
    }
    timer = setTimeout(async () => {
      timer = undefined;
      dirty = false;
      running = true;
      try {
        await read();
      } catch {
        // The consumer retains its content and owns retry/error presentation.
      } finally {
        running = false;
        if (dirty) {
          schedule();
        }
      }
    }, delayMs);
  };
  return {
    schedule,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
