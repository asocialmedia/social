import { afterAll, expect, test } from "bun:test";

import {
  recordPublicSocialEvent,
  readPublicSocialGraph,
  recordPublicSocialSnapshot,
} from "@asm/protocols/discovery";
import type { JetstreamEvent } from "@asm/protocols/jetstream";

import { redis } from "../../redis";

const did = `did:plc:test${crypto.randomUUID().replaceAll("-", "")}` as const;
const keys = [
  `asm:public-social:v1:{${did}}`,
  `asm:public-social:v1:{${did}}:time`,
];
const event = (
  seq: number,
  operation: "create" | "delete",
  rkey = "fixture"
): JetstreamEvent => ({
  commit: {
    collection: "app.bsky.feed.like",
    operation,
    record: {
      subject: { uri: "at://did:plc:publicauthor/app.bsky.feed.post/example" },
    },
    rkey,
  },
  did,
  kind: "commit",
  seq,
  time: new Date().toISOString(),
});
afterAll(async () => {
  await redis.del(...keys);
  redis.disconnect();
});
test("public likes are reference-only, deduplicated, retractable, and stale replay cannot resurrect them", async () => {
  await recordPublicSocialEvent(redis, event(1, "create"));
  await recordPublicSocialEvent(redis, event(1, "create"));
  const first = await readPublicSocialGraph(redis, [did]);
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({
    action: "like",
    actor: did,
    target: "at://did:plc:publicauthor/app.bsky.feed.post/example",
  });
  await recordPublicSocialEvent(redis, event(2, "delete"));
  await recordPublicSocialEvent(redis, event(1, "create"));
  expect(await readPublicSocialGraph(redis, [did])).toEqual([]);
});
test("one followed account cannot grow the public graph beyond its retention budget", async () => {
  for (let seq = 3; seq < 230; seq += 1) {
    // oxlint-disable-next-line no-await-in-loop -- sequence order is part of the stream contract.
    await recordPublicSocialEvent(redis, event(seq, "create", `entry${seq}`));
  }
  expect(await redis.hlen(keys[0] ?? "")).toBe(200);
  expect(await redis.zcard(keys[1] ?? "")).toBe(200);
  const entries = await readPublicSocialGraph(redis, [did]);
  expect(entries.length).toBe(200);
});

test("repository backfill cannot resurrect an unlike observed on the live stream", async () => {
  const record = {
    action: "like" as const,
    at: Date.now(),
    rkey: "backfill",
    target: "at://did:plc:publicauthor/app.bsky.feed.post/example",
  };
  await recordPublicSocialSnapshot(redis, did, [record]);
  await recordPublicSocialEvent(redis, event(300, "delete", "backfill"));
  await recordPublicSocialSnapshot(redis, did, [record]);
  const raw = await redis.hget(keys[0] ?? "", "like:backfill");
  expect(JSON.parse(raw ?? "null")).toMatchObject({ seq: 300, target: null });
});
