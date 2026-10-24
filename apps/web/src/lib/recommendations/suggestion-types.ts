import type { RecommendedAccount } from "@asm/protocols/discovery";

export {
  recommendedAccountSchema,
  recommendedPostSchema,
  discoverySuggestionsSchema,
} from "@asm/protocols/discovery";
export type {
  RecommendedAccount,
  RecommendedPost,
  DiscoverySuggestions,
} from "@asm/protocols/discovery";
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
