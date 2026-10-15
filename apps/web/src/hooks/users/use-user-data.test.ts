import { beforeEach, expect, mock, test } from "bun:test";

const state = { summaryCalls: [] as string[], viewerId: "owner" };
const row = {
  communityMembers: [],
  createdAt: new Date(),
  followsFollows: [],
  id: "owner",
  username: "owner",
};

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve({ user: { id: state.viewerId } }),
}));
mock.module("@asm/db", () => ({
  fromPrismaDateTime: (value: Date) => value,
  getPrivateUserQuery: () => ({
    where: () => ({ first: () => Promise.resolve(row) }),
  }),
  getUserProfileSummary: (_orm: unknown, userId: string, viewerId: string) => {
    state.summaryCalls.push(`${userId}:${viewerId}`);
    return Promise.resolve({
      _count: { followers: 9, following: 12, posts: 17 },
      mutuals: { followers: [], following: [] },
    });
  },
  prisma: { orm: {} },
}));
const { getUserData } = await import("./use-user-data");

beforeEach(() => {
  state.viewerId = "owner";
  state.summaryCalls = [];
});

test("the Home owner payload includes actual totals instead of missing count fields", async () => {
  const user = await getUserData("owner");
  expect(user?._count).toEqual({ followers: 9, following: 12, posts: 17 });
  expect(state.summaryCalls).toEqual(["owner:owner"]);
});

test("private Home data still requires the session owner", async () => {
  expect(await getUserData("another-person")).toBeNull();
  expect(state.summaryCalls).toEqual([]);
});
