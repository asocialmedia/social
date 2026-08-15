import type { TrendingAuraUser, TrendingMention } from "./trending-actions";

export type { TrendingAuraUser, TrendingMention } from "./trending-actions";

// Picks the top aura users to show in the Trending card, skipping anyone who
// already appears in the mentioned list so nobody is shown twice. Candidates
// are fetched beyond the display cap so the section still fills to 3 even when
// overlap with the mentions list removes some.
//
// Lives outside trending-actions.ts because that module is a "use server"
// action file, where every export must be an async server action.
export function selectTopAuraUsers(
  topAura: TrendingAuraUser[],
  mentions: TrendingMention[]
): TrendingAuraUser[] {
  const mentionedUserIds = new Set(mentions.map((mention) => mention.userId));
  return topAura
    .filter((user) => !mentionedUserIds.has(user.userId))
    .slice(0, 3);
}
