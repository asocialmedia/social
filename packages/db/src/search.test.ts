import { describe, expect, mock, test } from "bun:test";
import path from "node:path";

interface SearchQuery {
  all: () => Promise<Record<string, unknown>[]>;
  include: (
    relation: string,
    query: (relationQuery: unknown) => unknown
  ) => SearchQuery;
  limit: (value: number) => SearchQuery;
  orderBy: (order: (model: Record<string, unknown>) => unknown) => SearchQuery;
  where: (
    predicate:
      | ((model: Record<string, unknown>) => unknown)
      | Record<string, unknown>
  ) => SearchQuery;
}

interface SearchModel {
  select: (...fields: string[]) => SearchQuery;
}

function createQuery(
  rows: Record<string, unknown>[],
  call?: { limit?: number }
): SearchQuery {
  const query: SearchQuery = {
    all: () => Promise.resolve(rows),
    include: () => query,
    limit: (value) => {
      if (call) {
        call.limit = value;
      }
      return query;
    },
    orderBy: () => query,
    where: () => query,
  };
  return query;
}

function createModel(
  rows: Record<string, unknown>[],
  call?: { limit?: number }
): SearchModel {
  return { select: () => createQuery(rows, call) };
}

const users: Record<string, unknown>[] = [
  {
    aura: 10,
    avatarUrl: null,
    badge: null,
    badges: null,
    bio: null,
    displayName: "Alice",
    displayUsername: null,
    id: "u1",
    username: "alice",
  },
];

const posts: Record<string, unknown>[] = [
  {
    aura: 20,
    community: null,
    content: "hello",
    createdAt: new Date("2026-09-20T12:00:00.000Z"),
    explicitContent: false,
    id: "p1",
    isGust: false,
    postMedias: [{ _type: "IMAGE", id: "m1", thumbnailKey: "thumb" }],
    user: {
      avatarUrl: null,
      badge: null,
      badges: null,
      displayName: "Alice",
      id: "u1",
      username: "alice",
    },
    viewCount: 4,
  },
];

const communities: Record<string, unknown>[] = [
  {
    accentColor: "red",
    avatarUrl: null,
    communityMembers: 2,
    createdAt: new Date("2026-09-20T12:00:00.000Z"),
    id: "c1",
    name: "Rust",
    slug: "rust",
  },
  {
    accentColor: "blue",
    avatarUrl: null,
    communityMembers: 5,
    createdAt: new Date("2026-09-19T12:00:00.000Z"),
    id: "c2",
    name: "Design",
    slug: "design",
  },
];

const userCall: { limit?: number } = {};
const postCall: { limit?: number } = {};

const mockPrisma = {
  orm: {
    public: {
      Communities: createModel(communities),
      Posts: createModel(posts, postCall),
      Users: createModel(users, userCall),
    },
  },
};

mock.module("@prisma/orm-postgres/orm-client", () => ({
  and: (...expressions: unknown[]) => expressions,
  or: (...expressions: unknown[]) => expressions,
}));

mock.module("./prisma", () => ({
  default: mockPrisma,
  fromPrismaDateTime: (value: unknown) =>
    value instanceof Date ? value : new Date(String(value)),
  toPrismaDateTime: (value: Date) => value,
}));

describe("search", () => {
  test("searchUsers returns [] for an empty query", async () => {
    const { searchUsers } = await import("./search");
    expect(await searchUsers("  ")).toEqual([]);
  });

  test("searchUsers normalizes nullable badges and applies the limit", async () => {
    const { searchUsers } = await import("./search");
    expect(await searchUsers(" alice ", 3)).toEqual([
      expect.objectContaining({ badges: [], id: "u1", username: "alice" }),
    ]);
    expect(userCall.limit).toBe(3);
  });

  test("searchPosts maps author, media, community, and Prisma dates", async () => {
    const { searchPosts } = await import("./search");
    expect(await searchPosts("hello", 1)).toEqual([
      expect.objectContaining({
        authorId: "u1",
        authorUsername: "alice",
        id: "p1",
        previewMedia: {
          id: "m1",
          thumbnailKey: "thumb",
          type: "IMAGE",
        },
      }),
    ]);
    expect(postCall.limit).toBe(1);
  });

  test("searchCommunitiesForSearch sorts by members and caps results", async () => {
    const { searchCommunitiesForSearch } = await import("./search");
    expect(await searchCommunitiesForSearch("design", 1)).toEqual([
      expect.objectContaining({ id: "c2", memberCount: 5 }),
    ]);
  });

  test("declares trigram indexes for every substring search column", async () => {
    const contract = await Bun.file(
      path.join(import.meta.dirname, "../prisma/contract.prisma")
    ).text();
    const indexedColumns = [
      "username gin_trgm_ops",
      '\\"displayName\\" gin_trgm_ops',
      '\\"displayUsername\\" gin_trgm_ops',
      "content gin_trgm_ops",
      "description gin_trgm_ops",
      "name gin_trgm_ops",
      "slug gin_trgm_ops",
    ];

    for (const expression of indexedColumns) {
      expect(contract).toContain(expression);
    }
  });
});
