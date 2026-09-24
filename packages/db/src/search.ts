import { and, or } from "@prisma/orm-postgres/orm-client";

import prisma, { fromPrismaDateTime, toPrismaDateTime } from "./prisma";
import { SYSTEM_MODERATION_USER_ID } from "./users/reserved-usernames";

export interface SearchUserResult {
  aura: number;
  avatarUrl: string | null;
  badge: string | null;
  badges: readonly string[];
  bio: string | null;
  displayName: string;
  displayUsername: string | null;
  id: string;
  username: string;
}

export interface SearchPostResult {
  aura: number;
  authorAvatarUrl: string | null;
  authorBadge: string | null;
  authorBadges: readonly string[];
  authorDisplayName: string;
  authorId: string;
  authorUsername: string;
  community: { slug: string } | null;
  content: string;
  createdAt: Date;
  explicitContent: boolean;
  id: string;
  isGust: boolean;
  previewMedia: {
    id: string;
    thumbnailKey: string | null;
    type: string;
  } | null;
  viewCount: number;
}

export interface SearchCommunityResult {
  accentColor: string;
  avatarUrl: string | null;
  id: string;
  memberCount: number;
  name: string;
  slug: string;
}

function insensitiveContainsPattern(query: string): string {
  return `%${query.replaceAll(/[\\%_]/g, "\\$&")}%`;
}

export async function searchUsers(
  query: string,
  limit = 10
): Promise<SearchUserResult[]> {
  const q = query.trim();
  if (!q) {
    return [];
  }

  const pattern = insensitiveContainsPattern(q);
  const now = toPrismaDateTime(new Date());
  const users = await prisma.orm.public.Users.select(
    "aura",
    "avatarUrl",
    "badge",
    "badges",
    "bio",
    "displayName",
    "displayUsername",
    "id",
    "username"
  )
    .where((user) =>
      and(
        user.id.neq(SYSTEM_MODERATION_USER_ID),
        or(
          user.username.ilike(pattern),
          user.displayName.ilike(pattern),
          user.displayUsername.ilike(pattern),
          user.usernameAliases.some((alias) =>
            and(alias.expiresAt.gt(now), alias.username.ilike(pattern))
          )
        )
      )
    )
    .orderBy((user) => user.aura.desc())
    .limit(limit)
    .all();
  return users.map((user) => ({
    ...user,
    badges: user.badges ?? [],
  }));
}

export async function searchPosts(
  query: string,
  limit = 10
): Promise<SearchPostResult[]> {
  const q = query.trim();
  if (!q) {
    return [];
  }

  const posts = await prisma.orm.public.Posts.select(
    "aura",
    "content",
    "createdAt",
    "explicitContent",
    "id",
    "isGust",
    "viewCount"
  )
    .include("postMedias", (media) =>
      media.select("id", "thumbnailKey", "_type").limit(1)
    )
    .include("community", (community) => community.select("slug"))
    .include("user", (user) =>
      user.select(
        "avatarUrl",
        "badge",
        "badges",
        "displayName",
        "id",
        "username"
      )
    )
    .where((post) =>
      and(
        post.moderated.eq(false),
        post.rootPostId.isNull(),
        post.content.ilike(insensitiveContainsPattern(q))
      )
    )
    .orderBy((post) => post.createdAt.desc())
    .limit(limit)
    .all();

  return posts.map((post) => {
    if (!post.user) {
      throw new Error(`Post ${post.id} has no author`);
    }
    return {
      aura: post.aura,
      authorAvatarUrl: post.user.avatarUrl,
      authorBadge: post.user.badge,
      authorBadges: post.user.badges ?? [],
      authorDisplayName: post.user.displayName,
      authorId: post.user.id,
      authorUsername: post.user.username,
      community: post.community,
      content: post.content,
      createdAt: fromPrismaDateTime(post.createdAt),
      explicitContent: post.explicitContent,
      id: post.id,
      isGust: post.isGust,
      previewMedia: post.postMedias[0]
        ? {
            id: post.postMedias[0].id,
            thumbnailKey: post.postMedias[0].thumbnailKey,
            type: post.postMedias[0]._type,
          }
        : null,
      viewCount: post.viewCount,
    };
  });
}

export async function searchCommunitiesForSearch(
  query: string,
  limit = 6
): Promise<SearchCommunityResult[]> {
  const q = query.trim();
  if (!q) {
    return [];
  }

  const boundedLimit = Math.min(Math.max(limit, 1), 20);
  const pattern = insensitiveContainsPattern(q);
  const communities = await prisma.orm.public.Communities.select(
    "accentColor",
    "avatarUrl",
    "createdAt",
    "id",
    "name",
    "slug"
  )
    .include("communityMembers", (members) =>
      members.where((member) => member.status.eq("ACTIVE")).count()
    )
    .where((community) =>
      and(
        community._type.neq("PRIVATE"),
        or(
          community.name.ilike(pattern),
          community.slug.ilike(pattern),
          community.description.ilike(pattern)
        )
      )
    )
    .all();
  return communities
    .toSorted((left, right) => {
      const memberDifference = right.communityMembers - left.communityMembers;
      if (memberDifference !== 0) {
        return memberDifference;
      }
      const createdDifference =
        fromPrismaDateTime(right.createdAt).getTime() -
        fromPrismaDateTime(left.createdAt).getTime();
      return createdDifference || left.id.localeCompare(right.id);
    })
    .slice(0, boundedLimit)
    .map((community) => ({
      accentColor: community.accentColor,
      avatarUrl: community.avatarUrl,
      id: community.id,
      memberCount: community.communityMembers,
      name: community.name,
      slug: community.slug,
    }));
}
