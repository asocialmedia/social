import { beforeEach, describe, expect, mock, test } from "bun:test";

let session: { user: { id: string } } | null = { user: { id: "user-123" } };
let deleteCount = 0;

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(session),
}));

mock.module("@asm/db", () => ({
  prisma: {
    orm: {
      public: {
        Accounts: {
          where: () => ({
            deleteAndCount: () => {
              deleteCount += 1;
              return Promise.resolve({ count: 1 });
            },
          }),
        },
      },
    },
  },
}));

const { POST } = await import("./route");

beforeEach(() => {
  session = { user: { id: "user-123" } };
  deleteCount = 0;
});

describe("Bluesky unlink route", () => {
  test("returns 401 when unauthorized", async () => {
    session = null;
    const response = await POST();
    expect(response.status).toBe(401);
    expect(deleteCount).toBe(0);
  });

  test("deletes bluesky account and returns 200 on success", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(deleteCount).toBe(1);
  });
});
