import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { POST } from "./route";

const USER_ID = "user1";
const POST_ID = "post1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

let upserted = false;

const mockPrisma = {
  orm: {
    public: {
      PostVisits: {
        create: () => {
          upserted = true;
          return {};
        },
        select: () => ({
          where: () => ({ first: () => Promise.resolve(null) }),
        }),
        where: () => ({ update: () => Promise.resolve({}) }),
      },
      Posts: {
        select: () => ({
          where: (where: { id: string }) => ({
            first: () =>
              Promise.resolve(where.id === POST_ID ? { id: POST_ID } : null),
          }),
        }),
      },
    },
  },
};

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  prisma: mockPrisma,
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("POST /api/posts/visit", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    upserted = false;
  });

  test("rejects unauthenticated requests", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await POST(
      new Request("http://localhost/api/posts/visit", {
        body: JSON.stringify({ postId: POST_ID }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(res.status).toBe(401);
    expect(upserted).toBe(false);
  });

  test("rejects requests without a postId", async () => {
    const res = await POST(
      new Request("http://localhost/api/posts/visit", {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(res.status).toBe(400);
    expect(upserted).toBe(false);
  });

  test("returns 404 for a missing post", async () => {
    const res = await POST(
      new Request("http://localhost/api/posts/visit", {
        body: JSON.stringify({ postId: "missing" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(res.status).toBe(404);
    expect(upserted).toBe(false);
  });

  test("records the visit for an authenticated user", async () => {
    const res = await POST(
      new Request("http://localhost/api/posts/visit", {
        body: JSON.stringify({ postId: POST_ID }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    expect(res.status).toBe(200);
    expect(upserted).toBe(true);
  });
});
