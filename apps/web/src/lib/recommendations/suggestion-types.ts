import { z } from "zod";

export const recommendedAccountSchema = z.object({
  avatarUrl: z.string().nullable(),
  bannerUrl: z.string().nullable().optional(),
  displayName: z.string(),
  followers: z.number().nonnegative(),
  following: z.boolean(),
  handle: z.string(),
  href: z.string(),
  id: z.string(),
  reason: z.string(),
  source: z.enum(["asm", "bluesky"]),
});
export const recommendedPostSchema = z.object({
  authorId: z.string(),
  avatarUrl: z.string().nullable(),
  displayName: z.string(),
  href: z.string(),
  id: z.string(),
  reason: z.string(),
  source: z.enum(["asm", "bluesky"]),
  subtitle: z.string(),
});
export const discoverySuggestionsSchema = z.object({
  accounts: z.array(recommendedAccountSchema).max(12),
  partial: z.boolean(),
  posts: z.array(recommendedPostSchema).max(12),
  profileId: z.string(),
});
export type RecommendedAccount = z.infer<typeof recommendedAccountSchema>;
export type RecommendedPost = z.infer<typeof recommendedPostSchema>;
export type DiscoverySuggestions = z.infer<typeof discoverySuggestionsSchema>;

export function suggestionAccountKey(
  account: Pick<RecommendedAccount, "id" | "source">
) {
  return `${account.source}:${account.id}`;
}

export function mixSuggestionSources<
  T extends { id: string; source: "asm" | "bluesky"; score: number },
>(items: T[], limit: number): T[] {
  const unique = [
    ...new Map(
      items
        .toSorted((a, b) => a.score - b.score)
        .map((item) => [`${item.source}:${item.id}`, item])
    ).values(),
  ];
  const native = unique
    .filter((item) => item.source === "asm")
    .toSorted((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const external = unique
    .filter((item) => item.source === "bluesky")
    .toSorted((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const result: T[] = [];
  let nativeFirst =
    (native[0]?.score ?? -Infinity) >= (external[0]?.score ?? -Infinity);
  while (result.length < limit && (native.length || external.length)) {
    const pool = nativeFirst ? native : external;
    const next = pool.shift() ?? (nativeFirst ? external : native).shift();
    if (next) {
      result.push(next);
    }
    nativeFirst = !nativeFirst;
  }
  return result;
}
