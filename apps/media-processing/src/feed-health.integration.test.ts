import { expect, test } from "bun:test";

import { redis } from "@asm/db";
import {
  decideFeedAuthority,
  mediaFeedHealthSchema,
  readFeedHealth,
} from "@asm/protocols/discovery";

import { createMediaFeedPublisher } from "./feed-health";

test("media publishes classifier health through authenticated HTTP and expiring Redis state", async () => {
  let active = 1;
  let waiting = 1;
  const token = "local-feed-authority-classifier-token";
  const server = Bun.serve({
    fetch(request) {
      if (
        new URL(request.url).pathname !== "/v1/model" ||
        request.headers.get("authorization") !== `Bearer ${token}`
      ) {
        return new Response(null, { status: 401 });
      }
      return Response.json({ queue: { active, limit: 1, waiting } });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  const key = `test:feed-authority:${crypto.randomUUID()}`;
  const queue = {
    getJobs: () => Promise.resolve([{ timestamp: Date.now() - 100 }]),
    getWaitingCount: () => Promise.resolve(1),
  };
  try {
    const publish = createMediaFeedPublisher({
      classifierToken: token,
      classifierUrl: server.url.href,
      enrichment: queue,
      safety: queue,
      write: (_key, value, unit, ttl) => redis.set(key, value, unit, ttl),
    });
    await publish();
    const busy = readFeedHealth(mediaFeedHealthSchema, await redis.get(key));
    expect(busy?.classifier).toBe("busy");
    expect(decideFeedAuthority(null, busy).acceptSafetyJobs).toBe(false);
    expect(await redis.ttl(key)).toBeGreaterThan(0);
    active = 0;
    waiting = 0;
    await publish();
    const healthy = readFeedHealth(mediaFeedHealthSchema, await redis.get(key));
    expect(healthy?.classifier).toBe("ready");
    expect(decideFeedAuthority(null, healthy).acceptSafetyJobs).toBe(true);
    await server.stop();
    await publish();
    expect(
      readFeedHealth(mediaFeedHealthSchema, await redis.get(key))?.classifier
    ).toBe("unavailable");
  } finally {
    await server.stop(true);
    await redis.del(key);
  }
});
