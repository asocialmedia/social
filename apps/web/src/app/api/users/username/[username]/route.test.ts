import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { UserData } from "@asm/db";

const state = {
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
