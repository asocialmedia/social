import { createHash } from "node:crypto";

import type { ExternalPost } from "@asm/protocols/contracts";
import { abortable } from "@asm/protocols/discovery";

import { getQueue } from "../queue";
import { redis } from "./redis";

export const EXTERNAL_MEDIA_SAFETY_QUEUE = "external-media-safety";
export const EXTERNAL_MEDIA_SAFETY_VERSION = "v1";

export function externalMediaSafetyInput(post: ExternalPost) {
  const visited = new Set<ExternalPost>();
  const images: string[] = [];
  const text: string[] = [];
  let current: ExternalPost | undefined = post;
  while (current && !visited.has(current) && visited.size < 4) {
    visited.add(current);
    text.push(current.text, current.author.description ?? "");
    images.push(
      ...current.media.map((media) => media.thumbnailUrl ?? media.url),
      ...(current.externalLink?.thumbnailUrl
        ? [current.externalLink.thumbnailUrl]
        : [])
    );
    current = current.quote;
  }
  const input = {
    images: [...new Set(images)],
    text: text.join("\n").slice(0, 8000),
  };
  return {
    ...input,
    key: `external:media-safety:${EXTERNAL_MEDIA_SAFETY_VERSION}:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`,
  };
}

// Unknown or failed assessments never become safe through a cache miss or provider outage.
export async function filterExternalMediaSafety(
  posts: ExternalPost[]
): Promise<ExternalPost[]> {
  const inputs = posts.map(externalMediaSafetyInput);
  const visual = inputs.filter((input) => input.images.length > 0);
  if (!visual.length) {
    return posts;
  }
  const verdicts = new Map<string, string | null>();
  try {
    const keys = [...new Set(visual.map((input) => input.key))];
    const values = await abortable(
      redis.mget(...keys),
      AbortSignal.timeout(250)
    );
    for (const [index, key] of keys.entries()) {
      verdicts.set(key, values[index]);
    }
    const pending = visual.filter(
      (input) => input.images.length <= 20 && !verdicts.get(input.key)
    );
    if (pending.length) {
      const queue = getQueue(EXTERNAL_MEDIA_SAFETY_QUEUE);
      const waiting = await abortable(
        queue.getWaitingCount(),
        AbortSignal.timeout(250)
      );
      if (waiting < 500) {
        await abortable(
          Promise.all(
            pending.slice(0, Math.max(0, 500 - waiting)).map(async (input) => {
              const claimed = await redis.eval(
                "if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end local n = tonumber(redis.call('GET', KEYS[2]) or '0') if n >= 500 then return 0 end redis.call('SET', KEYS[1], '1', 'EX', 900) redis.call('INCR', KEYS[2]) redis.call('EXPIRE', KEYS[2], 900) return 1",
                2,
                `${input.key}:queued`,
                `external:media-safety:admission:${Math.floor(Date.now() / 900_000)}`
              );
              if (Number(claimed) !== 1) {
                return;
              }
              try {
                await queue.add(
                  "assess",
                  { ...input, queuedAt: Date.now() },
                  {
                    attempts: 2,
                    backoff: { delay: 30_000, type: "exponential" },
                    jobId: input.key.split(":").at(-1),
                    removeOnComplete: true,
                    removeOnFail: true,
                  }
                );
              } catch {
                await redis.del(`${input.key}:queued`);
              }
            })
          ),
          AbortSignal.timeout(250)
        );
      }
    }
  } catch {
    // Text remains available while Redis or the safety queue recovers.
  }
  return posts.filter(
    (_, index) =>
      !inputs[index].images.length || verdicts.get(inputs[index].key) === "safe"
  );
}
