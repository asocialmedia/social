import { filterExternalMediaSafety, redis } from "@asm/db";
import {
  blueskyMediaIsExplicit,
  externalPostSchema,
} from "@asm/protocols/discovery";

// Assess verified inventory before a viewer consumes it; raw stream events never enter this pool.
export async function warmExternalMediaSafety() {
  const scope = "asm:protocols:{inventory:v2}";
  const ids = await redis.zrevrangebyscore(
    `${scope}:time`,
    "+inf",
    Date.now() - 120_000,
    "LIMIT",
    0,
    200
  );
  if (!ids.length) {
    return;
  }
  const snapshots = await redis.hmget(`${scope}:posts`, ...ids);
  const posts = snapshots.flatMap((raw) => {
    try {
      const parsed = externalPostSchema.safeParse(raw ? JSON.parse(raw) : null);
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
  const prioritized = posts
    .filter((post) => !blueskyMediaIsExplicit(post))
    .toSorted(
      (first, second) =>
        Number(second.media.some((media) => media.type === "video")) -
        Number(first.media.some((media) => media.type === "video"))
    );
  await filterExternalMediaSafety(prioritized);
}
