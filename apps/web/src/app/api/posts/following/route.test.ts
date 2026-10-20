import { beforeEach, expect, mock, test } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

let preferences = defaultNetworkPreferences();
let authenticated = true;
const posts = [
  {
    content: "A landscape",
    explicitContent: false,
    id: "landscape",
    semanticTags: [],
    tags: [],
  },
  {
    content: "An adult post",
    explicitContent: true,
    id: "adult",
    semanticTags: [],
    tags: [],
  },
  {
    content: "Artwork",
    explicitContent: false,
    id: "furry",
    semanticTags: ["furryimages"],
    tags: [],
  },
];
interface PostQuery {
  all: () => Promise<typeof posts>;
  limit: () => PostQuery;
  orderBy: () => PostQuery;
  where: () => PostQuery;
}
const query: PostQuery = {
  all: () => Promise.resolve(posts),
  limit: () => query,
  orderBy: () => query,
  where: () => query,
};
const readPreferences = mock(() =>
  Promise.resolve({ preferences, revision: 0 })
);
mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  and: (...values: unknown[]) => values,
  getPostDataQuery: () => query,
  hydrateViewCounts: (values: unknown[]) => Promise.resolve(values),
  mapPostData: (value: unknown) => value,
  prisma: { orm: {} },
  readNetworkPreferences: readPreferences,
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () =>
    Promise.resolve(authenticated ? { user: { id: "new-account" } } : null),
}));
const { GET } = await import("./route");

beforeEach(() => {
  preferences = defaultNetworkPreferences();
  authenticated = true;
  readPreferences.mockClear();
});

test("Following honors adult-content defaults without requiring a network query flag", async () => {
  const response = await GET(
    new Request("http://localhost:3000/api/posts/following")
  );
  const page = await response.json();
  expect(page.posts.map((post: { id: string }) => post.id)).toEqual([
    "landscape",
  ]);
  expect(readPreferences).toHaveBeenCalledTimes(1);
});

test("Following honors related exclusions independently of explicit-content opt-in", async () => {
  preferences = {
    ...preferences,
    avoidedTopics: ["furry"],
    showExplicitContent: true,
  };
  const response = await GET(
    new Request("http://localhost:3000/api/posts/following")
  );
  const page = await response.json();
  expect(page.posts.map((post: { id: string }) => post.id)).toEqual([
    "landscape",
    "adult",
  ]);
});

test("Following still requires authentication before reading account preferences", async () => {
  authenticated = false;
  const response = await GET(
    new Request("http://localhost:3000/api/posts/following")
  );
  expect(response.status).toBe(401);
  expect(readPreferences).not.toHaveBeenCalled();
});
