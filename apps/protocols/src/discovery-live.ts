import { createHash } from "node:crypto";

import {
  discoveryContentSchema,
  discoveryLocaleSchema,
  discoveryModeSchema,
  discoveryTopicsSchema,
  FEED_EVENTS_CHANNEL,
} from "@asm/protocols/discovery";
import type { DiscoveryPage } from "@asm/protocols/discovery";
import { z } from "zod";

import type { DiscoveryStore } from "./discovery-store";

export const discoveryWatchSchema = z.object({
  content: discoveryContentSchema.default("all"),
  locale: discoveryLocaleSchema,
  mode: discoveryModeSchema,
  topics: discoveryTopicsSchema,
});
type Watch = z.infer<typeof discoveryWatchSchema>;

// Public generators also change when previously unseen authors enter their rankings.
// Reconcile each active candidate pool once on the server, rather than per viewer.
export function createDiscoveryLive(options: {
  store: DiscoveryStore;
  read: (watch: Watch, refresh: boolean) => Promise<DiscoveryPage>;
  publish: (channel: string, message: string) => Promise<unknown>;
  now?: () => number;
}) {
  const watches = new Map<
    string,
    { watch: Watch; expires: number; due: number }
  >();
  const now = options.now ?? Date.now;
  let running = false;
  let stopped = false;
  return {
    invalidate: () => {
      for (const entry of watches.values()) {
        entry.due = Math.min(entry.due, now() + 2000);
      }
    },
    stop: () => {
      stopped = true;
      watches.clear();
    },
    tick: async () => {
      if (running || stopped) {
        return;
      }
      running = true;
      try {
        // Limit upstream concurrency; a second tick continues the remaining pools.
        const due = [...watches.entries()]
          .filter(([, entry]) => entry.expires > now() && entry.due <= now())
          .slice(0, 2);
        await Promise.all(
          due.map(async ([id, entry]) => {
            entry.due = now() + 20_000;
            const key = `live:v1:${id}`;
            const owner = crypto.randomUUID();
            if (!(await options.store.acquire(key, owner))) {
              return;
            }
            try {
              const previous = await options.store.get(key);
              const saved = previous
                ? (JSON.parse(previous) as { at: number; fingerprint: string })
                : null;
              if (saved && now() - saved.at < 5000) {
                return;
              }
              const page = await options.read(entry.watch, Boolean(saved));
              const fingerprint = createHash("sha256")
                .update(
                  JSON.stringify(
                    page.items.map((post) => [post.id, post.revision])
                  )
                )
                .digest("hex");
              if (page.partial) {
                entry.due = now() + 5000;
              }
              await options.store.set(
                key,
                JSON.stringify({ at: now(), fingerprint }),
                90_000,
                { key, owner }
              );
              if (saved?.fingerprint !== fingerprint) {
                await options.publish(
                  FEED_EVENTS_CHANNEL,
                  JSON.stringify({
                    locale: entry.watch.locale,
                    mode: entry.watch.mode,
                    source: "bluesky",
                  })
                );
              }
            } catch {
              entry.due = now() + 5000;
            } finally {
              await options.store.release(key, owner);
            }
          })
        );
      } finally {
        running = false;
      }
    },
    watch: (raw: unknown) => {
      const renewal = z
        .object({
          locale: discoveryLocaleSchema,
          renew: z.literal(true),
          topics: discoveryTopicsSchema,
        })
        .safeParse(raw);
      if (renewal.success) {
        for (const entry of watches.values()) {
          if (
            entry.watch.locale === renewal.data.locale &&
            (entry.watch.mode !== "personalized" ||
              JSON.stringify(entry.watch.topics) ===
                JSON.stringify(renewal.data.topics))
          ) {
            entry.expires = now() + 65_000;
          }
        }
        return;
      }
      const parsed = discoveryWatchSchema.safeParse(raw);
      if (!parsed.success || stopped) {
        return;
      }
      const key = createHash("sha256")
        .update(JSON.stringify(parsed.data))
        .digest("hex");
      for (const [id, entry] of watches) {
        if (entry.expires < now()) {
          watches.delete(id);
        }
      }
      if (!watches.has(key) && watches.size >= 64) {
        return;
      }
      const previous = watches.get(key);
      watches.set(key, {
        due: previous?.due ?? 0,
        expires: now() + 65_000,
        watch: parsed.data,
      });
    },
  };
}
