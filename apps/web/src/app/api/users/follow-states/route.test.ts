import { beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  countRows: [] as { count: number; followingId: string }[],
  followRows: [] as { followingId: string }[],
  groupByCalls: 0,
  materializedFollowerRows: 0,
  session: { user: { id: "viewer-1" } } as { user: { id: string } } | null,
};

mock.module("@asm/db", () => ({
  and: (...expressions: unknown[]) => expressions,
  prisma: {
    orm: {
      public: {
        Follows: {
          select: () => ({
            where: () => ({
              all: () => state.followRows,
            }),
          }),
          where: () => ({
            groupBy: () => {
              state.groupByCalls += 1;
              return {
                aggregate: (
                  select: (aggregate: { count: () => number }) => unknown
                ) => {
                  select({ count: () => state.countRows.length });
                  return state.countRows;
                },
                all: () => {
                  state.materializedFollowerRows += 1;
                  return state.countRows;
                },
              };
            },
          }),
        },
      },
    },
  },
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => state.session,
}));

const { POST } = await import("./route");

function request(payload: unknown): Request {
  return new Request("http://localhost/api/users/follow-states", {
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("follow-states route", () => {
  beforeEach(() => {
    state.countRows = [];
    state.followRows = [];
    state.groupByCalls = 0;
    state.materializedFollowerRows = 0;
    state.session = { user: { id: "viewer-1" } };
  });

  test("rejects unauthenticated requests", async () => {
    state.session = null;
    const response = await POST(request({ userIds: ["user-1"] }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  test("rejects malformed and oversized user id lists", async () => {
    const malformed = await POST(request({ userIds: [""] }));
    const oversized = await POST(
      request({
        userIds: Array.from({ length: 101 }, (_, index) => `u${index}`),
      })
    );

    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(400);
  });

  test("returns an empty response without querying for an empty list", async () => {
    const response = await POST(request({ userIds: [] }));

    expect(await response.json()).toEqual({});
    expect(state.groupByCalls).toBe(0);
  });

  test("counts followers in the database and preserves the response shape", async () => {
    state.followRows = [{ followingId: "user-1" }];
    state.countRows = [
      { count: 42, followingId: "user-1" },
      { count: 7, followingId: "user-2" },
    ];

    const response = await POST(
      request({ userIds: ["user-1", "user-2", "user-3", "user-1"] })
    );

    expect(await response.json()).toEqual({
      "user-1": { followers: 42, isFollowedByUser: true },
      "user-2": { followers: 7, isFollowedByUser: false },
      "user-3": { followers: 0, isFollowedByUser: false },
    });
    expect(state.groupByCalls).toBe(1);
    expect(state.materializedFollowerRows).toBe(0);
  });
});
