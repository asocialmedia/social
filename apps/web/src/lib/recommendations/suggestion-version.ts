import { redis } from "@asm/db";

export async function invalidateDiscoverySuggestions(userId: string) {
  await redis
    .set(
      `rec:suggestions:version:${userId}`,
      crypto.randomUUID(),
      "EX",
      30 * 24 * 60 * 60
    )
    .catch(() => null);
}
