import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { UserData } from "@asm/db";

const state = {
  countUserIds: [] as string[],
  resolved: { id: "user-1", username: "canonical" } as {
    id: string;
    username: string;
  } | null,
  session: { user: { id: "viewer-1" } } as {
    user: { id: string };
  } | null,
  viewerIds: [] as string[],
};

const user = {
  _count: { followers: 2, following: 3, posts: 4 },
  aura: 5,
  id: "user-1",
  username: "canonical",
} as unknown as UserData;

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(state.session),
}));

mock.module("@asm/db", () => ({
  getUserDataQuery: (_orm: unknown, viewerId: string) => {
    state.viewerIds.push(viewerId);
    return {
      first: () => Promise.resolve(user),
      where: () => ({
        first: () => Promise.resolve(user),
      }),
    };
  },
  getUserProfileCounts: (_orm: unknown, userId: string) => {
    state.countUserIds.push(userId);
    return Promise.resolve({ followers: 2, following: 3, posts: 4 });
  },
  mapUserData: (value: UserData) => value,
  prisma: { orm: {} },
  resolveUsername: () => Promise.resolve(state.resolved),
}));

const { GET } = await import("./route");

function request(username: string) {
  return {
    params: Promise.resolve({ username }),
  };
}

describe("GET /api/users/username/[username]", () => {
  beforeEach(() => {
    state.resolved = { id: "user-1", username: "canonical" };
    state.session = { user: { id: "viewer-1" } };
    state.viewerIds = [];
    state.countUserIds = [];
  });

  test("returns the public profile to guests", async () => {
    state.session = null;

    const response = await GET(
      new Request("http://localhost/api/users/username/oldhandle"),
      request("oldhandle")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(user);
    expect(state.viewerIds).toEqual([""]);
  });

  test("keeps follow state viewer-scoped for signed-in readers", async () => {
    const response = await GET(
      new Request("http://localhost/api/users/username/canonical"),
      request("canonical")
    );

    expect(response.status).toBe(200);
    expect(state.viewerIds).toEqual(["viewer-1"]);
    expect(state.countUserIds).toEqual(["user-1"]);
  });

  test("returns 404 when the username cannot resolve", async () => {
    state.resolved = null;

    const response = await GET(
      new Request("http://localhost/api/users/username/missing"),
      request("missing")
    );

    expect(response.status).toBe(404);
  });
});

test("the ID lookup also returns explicit totals rather than viewer-filtered relation lengths", async () => {
  const { GET: getById } = await import("../../[userId]/route");
  const response = await getById(
    new Request("http://localhost/api/users/user-1"),
    { params: Promise.resolve({ userId: "user-1" }) }
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body._count).toEqual({
    followers: 2,
    following: 3,
    posts: 4,
  });
});
