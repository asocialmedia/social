import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

let session: { user: { id: string } } | null = { user: { id: "user-1" } };
let row: { deleted: boolean; userId: string } | null = {
  deleted: false,
  userId: "user-1",
};
let softDelete: () => Promise<unknown> = () =>
  Promise.resolve({ deleted: true, id: "c1" });
const softDeleteComment = mock(() => softDelete());

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  prisma: {
    orm: {
      public: {
        Comments: {
          select: () => ({
            where: () => ({ first: () => Promise.resolve(row) }),
          }),
        },
      },
    },
  },
  redis: {},
}));
mock.module("@/components/comments/data/comment-service", () => ({
  softDeleteComment,
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(session),
}));
mock.module("@/lib/otel", () => ({ getWebLogger: () => null }));

const { DELETE } = await import("./route");

function call() {
  return DELETE(
    new Request("http://localhost/api/comments/c1", { method: "DELETE" }),
    {
      params: Promise.resolve({ commentId: "c1" }),
    }
  );
}

beforeEach(() => {
  session = { user: { id: "user-1" } };
  row = { deleted: false, userId: "user-1" };
  softDelete = () => Promise.resolve({ deleted: true, id: "c1" });
  softDeleteComment.mockClear();
});

describe("DELETE /api/comments/:id", () => {
  test("rejects guests", async () => {
    session = null;
    const res = await call();
    expect(res.status).toBe(401);
  });

  test("404s an unknown eddie and 403s someone else's", async () => {
    row = null;
    const missing = await call();
    expect(missing.status).toBe(404);
    row = { deleted: false, userId: "someone-else" };
    const foreign = await call();
    expect(foreign.status).toBe(403);
    expect(softDeleteComment).not.toHaveBeenCalled();
  });

  test("an already deleted eddie is a no-op success, so retries are safe", async () => {
    row = { deleted: true, userId: "user-1" };
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, id: "c1" });
    expect(softDeleteComment).not.toHaveBeenCalled();
  });

  test("soft-deletes the caller's eddie", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(softDeleteComment).toHaveBeenCalledTimes(1);
  });

  test("hides internal failures behind generic copy", async () => {
    softDelete = () => Promise.reject(new Error("db down"));
    const res = await call();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Couldn't delete that eddie, try again?");
  });
});
