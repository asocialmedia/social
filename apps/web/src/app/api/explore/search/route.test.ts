import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

interface QueryExpression {
  field: string;
  operator: string;
  value?: unknown;
}

interface QueryCall {
  limit?: number;
  orderBy?: QueryExpression[];
  where?: QueryExpression[];
}

interface SearchQuery {
  all: () => Promise<Record<string, unknown>[]>;
  limit: (value: number) => SearchQuery;
  orderBy: (
    predicate: (model: Record<string, unknown>) => unknown
  ) => SearchQuery;
  where: (
    predicate: (model: Record<string, unknown>) => unknown
  ) => SearchQuery;
}

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: "u1" },
}));

const postQueries: QueryCall[] = [];
const userQueries: QueryCall[] = [];

function createAccessor(path: string[] = []): Record<string, unknown> {
  return new Proxy<Record<string, unknown>>(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") {
          return;
        }
        const field = [...path, property].join(".");
        return new Proxy<Record<string, unknown>>(
          {},
          {
            get(_fieldTarget, operator) {
              if (typeof operator !== "string") {
                return;
              }
              return (value?: unknown) => {
                let expressionValue = value;
                if (
                  (operator === "some" || operator === "none") &&
                  typeof value === "function"
                ) {
                  expressionValue = value(createAccessor([...path, property]));
                }
                return { field, operator, value: expressionValue };
              };
            },
          }
        );
      },
    }
  );
}

function flattenExpression(value: unknown): QueryExpression[] {
  if (Array.isArray(value)) {
    return value.flatMap(flattenExpression);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const expression = value as QueryExpression;
  if (expression.operator === "some" || expression.operator === "none") {
    return flattenExpression(expression.value);
  }
  return [expression];
}

function findExpression(
  expressions: QueryExpression[],
  field: string,
  operator?: string
): QueryExpression | undefined {
  return expressions.find(
    (expression) =>
      expression.field === field &&
      (operator === undefined || expression.operator === operator)
  );
}

function createSearchQuery(
  call: QueryCall,
  rows: Record<string, unknown>[]
): SearchQuery {
  const query: SearchQuery = {
    all: () => Promise.resolve(rows.map((row) => ({ ...row }))),
    limit: (value) => {
      call.limit = value;
      return query;
    },
    orderBy: (predicate) => {
      call.orderBy = flattenExpression(predicate(createAccessor()));
      return query;
    },
    where: (predicate) => {
      call.where = flattenExpression(predicate(createAccessor()));
      return query;
    },
  };
  return query;
}

function createPostRows(): Record<string, unknown>[] {
  return [
    {
      aura: 50,
      content: "amazing viral gust",
      createdAt: new Date("2026-09-20T00:00:00.000Z"),
      id: "p1",
      isGust: true,
    },
  ];
}

let postRows = createPostRows();
const userRows: Record<string, unknown>[] = [
  {
    aura: 100,
    displayName: "Alice",
    id: "u1",
    username: "alice",
  },
];

const mockPrisma = {
  orm: {
    public: {
      Posts: {},
      Users: {},
    },
  },
};

mock.module("@asm/db", () => ({
  and: (...expressions: unknown[]) => expressions,
  communityVisibilityWhere: () => () => ({
    field: "communityVisibility",
    operator: "eq",
    value: "visible",
  }),
  getPostDataQuery: () => {
    const call: QueryCall = {};
    postQueries.push(call);
    return createSearchQuery(call, postRows);
  },
  getUserDataQuery: () => {
    const call: QueryCall = {};
    userQueries.push(call);
    return createSearchQuery(call, userRows);
  },
  hydrateViewCounts: mock((posts: unknown[]) => Promise.resolve(posts)),
  mapPostData: (post: unknown) => post,
  mapUserData: (user: unknown) => user,
  prisma: mockPrisma,
  searchCommunitiesForSearch: () => Promise.resolve([]),
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("GET /api/explore/search", () => {
  beforeEach(() => {
    postQueries.length = 0;
    userQueries.length = 0;
    postRows = createPostRows();
    mockGetSession.mockClear();
    mockGetSession.mockImplementation(() => ({ user: { id: "u1" } }));
  });

  test("returns empty arrays when query string is empty", async () => {
    const req = new Request("http://localhost:3000/api/explore/search?q=");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { posts: unknown[]; users: unknown[] };
    expect(json.posts).toEqual([]);
    expect(json.users).toEqual([]);
    expect(postQueries).toHaveLength(0);
    expect(userQueries).toHaveLength(0);
  });

  test("filters every Prisma 8 post query when tab=gusts", async () => {
    const req = new Request(
      "http://localhost:3000/api/explore/search?q=Viral&tab=gusts"
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(postQueries).toHaveLength(6);
    expect(userQueries).toHaveLength(3);
    for (const query of postQueries) {
      expect(query.limit).toBe(20);
      expect(findExpression(query.where ?? [], "isGust", "eq")?.value).toBe(
        true
      );
      expect(findExpression(query.where ?? [], "moderated", "eq")?.value).toBe(
        false
      );
      expect(
        findExpression(query.where ?? [], "rootPostId", "isNull")
      ).toBeDefined();
    }

    expect(
      findExpression(postQueries[0].where ?? [], "content", "ilike")?.value
    ).toBe("%Viral%");
    expect(
      findExpression(postQueries[1].where ?? [], "postToTags.tag.name", "ilike")
        ?.value
    ).toBe("%Viral%");
    expect(
      findExpression(postQueries[2].where ?? [], "semanticTags", "in")?.value
    ).toEqual([["viral"]]);
    expect(
      findExpression(
        postQueries[3].where ?? [],
        "postMedias.transcript",
        "ilike"
      )?.value
    ).toBe("%Viral%");
    expect(
      findExpression(postQueries[4].where ?? [], "postMedias.ocrText", "ilike")
        ?.value
    ).toBe("%Viral%");
    expect(
      findExpression(
        postQueries[5].where ?? [],
        "postMedias.semanticTags",
        "in"
      )?.value
    ).toEqual([["viral"]]);
  });

  test("orders returned posts by aura when tab=trending", async () => {
    postRows = [
      {
        aura: 50,
        content: "middle",
        createdAt: new Date("2026-09-21T00:00:00.000Z"),
        id: "p1",
      },
      {
        aura: 100,
        content: "top",
        createdAt: new Date("2026-09-20T00:00:00.000Z"),
        id: "p2",
      },
      {
        aura: 25,
        content: "bottom",
        createdAt: new Date("2026-09-22T00:00:00.000Z"),
        id: "p3",
      },
    ];
    const req = new Request(
      "http://localhost:3000/api/explore/search?q=trend&tab=trending"
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { posts: { id: string }[] };
    expect(json.posts.map((post) => post.id)).toEqual(["p2", "p1", "p3"]);
  });
});
