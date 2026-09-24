"use server";

import {
  and,
  getUserDataQuery,
  mapUserData,
  prisma,
  SYSTEM_MODERATION_USER_ID,
} from "@asm/db";
import type { CommunityRoleRow } from "@asm/db";

import { getTrendingTopics } from "./topic-actions";
import { selectTopAuraUsers } from "./trending-utils";

export interface TrendingMention {
  avatarUrl: string | null;
  badge: string | null;
  badges: string[];
  communityMemberships: CommunityRoleRow[];
  count: number;
  displayName: string;
  type: "mention";
  userId: string;
  username: string;
}

export interface TrendingHashtag {
  count: number;
  hashtag: string;
  type: "hashtag";
}

export interface TrendingAuraUser {
  aura: number;
  avatarUrl: string | null;
  badge: string | null;
  badges: string[];
  communityMemberships: CommunityRoleRow[];
  displayName: string | null;
  type: "aura";
  userId: string;
  username: string;
}

export type TrendingItem = TrendingHashtag | TrendingMention;

export interface TrendingFeed {
  items: TrendingItem[];
  topAura: TrendingAuraUser[];
}

async function getTopMentionedUsers(): Promise<TrendingMention[]> {
  try {
    const grouped = await prisma.orm.public.Mentions.where((mention) =>
      mention.userId.notIn([SYSTEM_MODERATION_USER_ID])
    )
      .groupBy("userId")
      .aggregate((aggregate) => ({ count: aggregate.count() }));
    const topGrouped = [...grouped]
      .toSorted((left, right) => right.count - left.count)
      .slice(0, 5);

    if (topGrouped.length === 0) {
      return [];
    }

    const users = await getUserDataQuery(prisma.orm, "")
      .where((user) =>
        and(
          user.id.notIn([SYSTEM_MODERATION_USER_ID]),
          user.id.in(topGrouped.map((group) => group.userId))
        )
      )
      .all()
      .then((rows) => rows.map(mapUserData));

    const userById = new Map(users.map((user) => [user.id, user]));

    return (
      topGrouped
        // Annotated so the Prisma enum on `role` widens to the DTO's `string`;
        // without it the type predicate below cannot narrow the mapped array.
        .map((group): TrendingMention | null => {
          const user = userById.get(group.userId);
          if (!user) {
            return null;
          }
          return {
            avatarUrl: user.avatarUrl,
            badge: user.badge,
            badges: [...(user.badges ?? [])],
            communityMemberships: user.communityMemberships,
            count: group.count,
            displayName: user.displayName,
            type: "mention",
            userId: user.id,
            username: user.username,
          };
        })
        .filter((item): item is TrendingMention => item !== null)
        .toSorted((a, b) => b.count - a.count)
    );
  } catch (error) {
    console.error("Error fetching top mentioned users:", error);
    return [];
  }
}

// Fetch extra candidates so dedupe against the mentioned list can still fill
// the Top Aura section to three entries.
const TOP_AURA_CANDIDATES = 10;

async function getTopAuraUsers(): Promise<TrendingAuraUser[]> {
  try {
    const users = await getUserDataQuery(prisma.orm, "")
      .where((user) =>
        and(user.banned.eq(false), user.id.notIn([SYSTEM_MODERATION_USER_ID]))
      )
      .orderBy((user) => user.aura.desc())
      .limit(TOP_AURA_CANDIDATES)
      .all()
      .then((rows) => rows.map(mapUserData));

    return users.map((user) => ({
      aura: user.aura,
      avatarUrl: user.avatarUrl,
      badge: user.badge,
      badges: [...(user.badges ?? [])],
      communityMemberships: user.communityMemberships,
      displayName: user.displayName,
      type: "aura" as const,
      userId: user.id,
      username: user.username,
    }));
  } catch (error) {
    console.error("Error fetching top aura users:", error);
    return [];
  }
}

export async function getTrendingFeed(
  bypassCache = false
): Promise<TrendingFeed> {
  const [topics, mentions, topAura] = await Promise.all([
    getTrendingTopics(bypassCache),
    getTopMentionedUsers(),
    getTopAuraUsers(),
  ]);

  const hashtags: TrendingHashtag[] = topics
    .slice(0, 5)
    .map(({ hashtag, count }) => ({ count, hashtag, type: "hashtag" }));

  const items = [...hashtags, ...mentions]
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 10);

  // Top Aura displays the platform's highest aura earners regardless of
  // mentions, ensuring high-standing members are always recognized.
  return { items, topAura: selectTopAuraUsers(topAura, mentions) };
}
