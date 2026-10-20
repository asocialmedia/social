import { z } from "zod";

import type { JetstreamEvent } from "./atproto/jetstream";

interface SocialRedis {
  eval: (
    script: string,
    keyCount: number,
    ...args: (string | number)[]
  ) => Promise<unknown>;
  hvals: (key: string) => Promise<string[]>;
}
const MAX_RECORDS = 200;
const RETENTION_SECONDS = 7 * 24 * 60 * 60;
const entrySchema = z.object({
  action: z.enum(["like", "repost", "follow"]),
  at: z.number().finite(),
  seq: z.number().int(),
  target: z.string().max(2300).nullable(),
});
const update = `
local previous = redis.call('HGET', KEYS[1], ARGV[1])
if previous then
  local decoded = cjson.decode(previous)
  if decoded.seq > tonumber(ARGV[2]) or (decoded.seq == tonumber(ARGV[2]) and (decoded.seq ~= 0 or decoded.at >= tonumber(ARGV[4]))) then return 0 end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[1])
local stale = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[5])
for _, id in ipairs(stale) do redis.call('HDEL', KEYS[1], id); redis.call('ZREM', KEYS[2], id) end
local overflow = redis.call('ZRANGE', KEYS[2], 0, -${MAX_RECORDS + 1})
for _, id in ipairs(overflow) do redis.call('HDEL', KEYS[1], id); redis.call('ZREM', KEYS[2], id) end
redis.call('EXPIRE', KEYS[1], ARGV[6])
redis.call('EXPIRE', KEYS[2], ARGV[6])
return 1
`;
const keyFor = (did: string) => `asm:public-social:v1:{${did}}`;

// Only public action references are retained; remote post bodies and private preferences never enter this graph.
export async function recordPublicSocialEvent(
  redis: SocialRedis,
  event: JetstreamEvent
) {
  if (event.kind !== "commit") {
    return;
  }
  const action = (
    {
      "app.bsky.feed.like": "like",
      "app.bsky.feed.repost": "repost",
      "app.bsky.graph.follow": "follow",
    } as const
  )[
    event.commit.collection as
      | "app.bsky.feed.like"
      | "app.bsky.feed.repost"
      | "app.bsky.graph.follow"
  ];
  if (!action) {
    return;
  }
  let target: string | null = null;
  if (event.commit.operation !== "delete") {
    const record = z
      .object({
        subject:
          action === "follow"
            ? z.string().regex(/^did:(?:plc|web):[A-Za-z0-9._:%-]+$/)
            : z.object({
                uri: z
                  .string()
                  .regex(
                    /^at:\/\/did:(?:plc|web):[^/]+\/app\.bsky\.feed\.post\/[A-Za-z0-9._~:-]+$/
                  ),
              }),
      })
      .safeParse(event.commit.record);
    if (!record.success) {
      return;
    }
    target =
      typeof record.data.subject === "string"
        ? record.data.subject
        : record.data.subject.uri;
  }
  const at = Date.parse(event.time);
  const entry = entrySchema.parse({ action, at, seq: event.seq, target });
  const key = keyFor(event.did);
  await redis.eval(
    update,
    2,
    key,
    `${key}:time`,
    `${action}:${event.commit.rkey}`,
    event.seq,
    JSON.stringify(entry),
    at,
    Date.now() - RETENTION_SECONDS * 1000,
    RETENTION_SECONDS
  );
}

export async function readPublicSocialGraph(
  redis: SocialRedis,
  dids: readonly string[],
  now = Date.now()
) {
  const actors = [...new Set(dids)].slice(0, 80);
  const rows = await Promise.all(actors.map((did) => redis.hvals(keyFor(did))));
  return rows.flatMap((values, index) =>
    values.slice(0, MAX_RECORDS).flatMap((value) => {
      try {
        const entry = entrySchema.parse(JSON.parse(value));
        return entry.target &&
          entry.at > now - RETENTION_SECONDS * 1000 &&
          entry.at <= now + 60_000
          ? [{ ...entry, actor: actors[index], target: entry.target }]
          : [];
      } catch {
        return [];
      }
    })
  );
}

export async function recordPublicSocialSnapshot(
  redis: SocialRedis,
  actor: string,
  records: {
    action: "like" | "repost" | "follow";
    at: number;
    rkey: string;
    target: string;
  }[]
) {
  const key = keyFor(actor);
  await Promise.all(
    records.slice(0, MAX_RECORDS).map(async (record) => {
      const entry = entrySchema.parse({ ...record, seq: 0 });
      await redis.eval(
        update,
        2,
        key,
        `${key}:time`,
        `${record.action}:${record.rkey}`,
        0,
        JSON.stringify(entry),
        entry.at,
        Date.now() - RETENTION_SECONDS * 1000,
        RETENTION_SECONDS
      );
    })
  );
}
