import type { TrendingAuraUser, TrendingMention } from "./trending-actions";

export type { TrendingAuraUser, TrendingMention } from "./trending-actions";

// Picks the top aura users to show in the Trending card. Always preserves
// the highest aura members so the leaderboard accurately reflects top
// standing rather than excluding them when they also receive mentions.
//
// Lives outside trending-actions.ts because that module is a "use server"
// action file, where every export must be an async server action.
export function selectTopAuraUsers(
  topAura: TrendingAuraUser[],
  _mentions?: TrendingMention[]
): TrendingAuraUser[] {
  return topAura.slice(0, 3);
}
