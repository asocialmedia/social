import prisma from "./prisma";

let ensurePromise: Promise<void> | null = null;

function ensureSearchIndexes(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      try {
        await prisma.$executeRawUnsafe(
          "CREATE EXTENSION IF NOT EXISTS pg_trgm"
        );
        await prisma.$executeRawUnsafe(
          "CREATE INDEX IF NOT EXISTS idx_users_username_trgm ON users USING gin (username gin_trgm_ops)"
        );
        await prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS idx_users_displayname_trgm ON users USING gin ("displayName" gin_trgm_ops)`
        );
        await prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS idx_users_displayusername_trgm ON users USING gin ("displayUsername" gin_trgm_ops)`
        );
        await prisma.$executeRawUnsafe(
          "CREATE INDEX IF NOT EXISTS idx_posts_content_trgm ON posts USING gin (content gin_trgm_ops)"
        );
      } catch (error) {
        ensurePromise = null;
        throw error;
      }
    })();
  }

  return ensurePromise;
}

export interface SearchUserResult {
  aura: number;
  avatarUrl: string | null;
  badge: string | null;
  badges: string[];
  bio: string | null;
  displayName: string;
  displayUsername: string | null;
  email: string | null;
  id: string;
  username: string;
}

export interface SearchPostResult {
  aura: number;
  authorAvatarUrl: string | null;
  authorDisplayName: string;
  authorId: string;
  authorUsername: string;
  content: string;
  createdAt: Date;
  id: string;
  viewCount: number;
}

export async function searchUsers(
  query: string,
  limit = 10
): Promise<SearchUserResult[]> {
  const q = query.trim();
  if (!q) {
    return [];
  }

  await ensureSearchIndexes();

  const users = await prisma.user.findMany({
    orderBy: { aura: "desc" },
    select: {
      aura: true,
      avatarUrl: true,
      badge: true,
      badges: true,
      bio: true,
      displayName: true,
      displayUsername: true,
      email: true,
      id: true,
      username: true,
    },
    take: limit,
    where: {
      OR: [
        { username: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
        { displayUsername: { contains: q, mode: "insensitive" } },
      ],
    },
  });

  return users;
}

export async function searchPosts(
  query: string,
  limit = 10
): Promise<SearchPostResult[]> {
  const q = query.trim();
  if (!q) {
    return [];
  }

  await ensureSearchIndexes();

  const posts = await prisma.post.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      aura: true,
      content: true,
      createdAt: true,
      id: true,
      user: {
        select: {
          avatarUrl: true,
          badge: true,
          badges: true,
          displayName: true,
          id: true,
          username: true,
        },
      },
      viewCount: true,
    },
    take: limit,
    where: {
      content: { contains: q, mode: "insensitive" },
    },
  });

  return posts.map((post) => ({
    aura: post.aura,
    authorAvatarUrl: post.user.avatarUrl,
    authorDisplayName: post.user.displayName,
    authorId: post.user.id,
    authorUsername: post.user.username,
    content: post.content,
    createdAt: post.createdAt,
    id: post.id,
    viewCount: post.viewCount,
  }));
}
