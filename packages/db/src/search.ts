import prisma from "./prisma";

let ensurePromise: Promise<void> | null = null;

function ensureSearchIndexes(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = Promise.resolve()
      .then(() =>
        prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS pg_trgm")
      )
      .then(() =>
        prisma.$executeRawUnsafe(
          "CREATE INDEX IF NOT EXISTS idx_users_username_trgm ON users USING gin (username gin_trgm_ops)"
        )
      )
      .then(() =>
        prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS idx_users_displayname_trgm ON users USING gin ("displayName" gin_trgm_ops)`
        )
      )
      .then(() =>
        prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS idx_users_displayusername_trgm ON users USING gin ("displayUsername" gin_trgm_ops)`
        )
      )
      .then(() =>
        prisma.$executeRawUnsafe(
          "CREATE INDEX IF NOT EXISTS idx_posts_content_trgm ON posts USING gin (content gin_trgm_ops)"
        )
      )
      .then(() => undefined)
      .catch((error) => {
        ensurePromise = null;
        throw error;
      });
  }

  return ensurePromise;
}

export interface SearchUserResult {
  avatarUrl: string | null;
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
    where: {
      OR: [
        { username: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
        { displayUsername: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      avatarUrl: true,
      bio: true,
      displayName: true,
      displayUsername: true,
      email: true,
      id: true,
      username: true,
    },
    orderBy: { aura: "desc" },
    take: limit,
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
    where: {
      content: { contains: q, mode: "insensitive" },
    },
    select: {
      aura: true,
      content: true,
      createdAt: true,
      id: true,
      viewCount: true,
      user: {
        select: {
          avatarUrl: true,
          displayName: true,
          id: true,
          username: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return posts.map((post) => ({
    authorAvatarUrl: post.user.avatarUrl,
    authorDisplayName: post.user.displayName,
    authorId: post.user.id,
    authorUsername: post.user.username,
    aura: post.aura,
    content: post.content,
    createdAt: post.createdAt,
    id: post.id,
    viewCount: post.viewCount,
  }));
}
