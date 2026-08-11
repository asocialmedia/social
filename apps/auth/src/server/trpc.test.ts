import { describe, expect, mock, test } from "bun:test";
import type { User as AuthUser, Session } from "@asm/auth/core";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

interface SessionFromRequestResult {
  session: Session | null;
  user: AuthUser | null;
}

const mockGetSessionFromRequest = mock(
  async (): Promise<SessionFromRequestResult> => ({
    session: null,
    user: null,
  })
);

mock.module("@asm/auth/core", () => ({
  getSessionFromRequest: mockGetSessionFromRequest,
}));

import {
  adminProcedure,
  createContext,
  protectedProcedure,
  router,
} from "./trpc";

function createBaseCtx(overrides: Record<string, unknown> = {}) {
  return {
    req: new Request("https://auth.localhost/api/trpc"),
    resHeaders: new Headers(),
    session: null,
    user: null,
    ...overrides,
  };
}

describe("server trpc", () => {
  test("createContext delegates to getSessionFromRequest", async () => {
    const req = new Request("https://auth.localhost/api/trpc");
    const resHeaders = new Headers();
    const session: Session = {
      id: "s1",
      userId: "u1",
      token: "t1",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      ipAddress: null,
      userAgent: null,
      createdAt: new Date("2030-01-01T00:00:00.000Z"),
      updatedAt: new Date("2030-01-01T00:00:00.000Z"),
    };
    const user: AuthUser = {
      id: "u1",
      email: "u1@example.com",
      emailVerified: true,
      name: "User One",
      username: "u1",
      role: "user",
      banned: false,
      image: null,
      createdAt: new Date("2030-01-01T00:00:00.000Z"),
      updatedAt: new Date("2030-01-01T00:00:00.000Z"),
    };

    const options: FetchCreateContextFnOptions = {
      req,
      resHeaders,
      info: {
        calls: [],
        connectionParams: null,
        isBatchCall: false,
        signal: new AbortController().signal,
        type: "query",
        accept: null,
        url: new URL(req.url),
      },
    };

    mockGetSessionFromRequest.mockResolvedValueOnce({
      session,
      user,
    });

    const ctx = await createContext(options);

    expect(mockGetSessionFromRequest).toHaveBeenCalledWith(req);
    expect(ctx.req).toBe(req);
    expect(ctx.resHeaders).toBe(resHeaders);
    expect(ctx.session).toEqual(session);
    expect(ctx.user).toEqual(user);
  });

  test("protectedProcedure rejects unauthenticated users", async () => {
    const testRouter = router({
      ping: protectedProcedure.query(() => "ok"),
    });

    const caller = testRouter.createCaller(createBaseCtx());
    await expect(caller.ping()).rejects.toThrow(
      "You must be logged in to perform this action"
    );
  });

  test("protectedProcedure passes with session and user", async () => {
    const testRouter = router({
      ping: protectedProcedure.query(({ ctx }) => ctx.user.id),
    });

    const caller = testRouter.createCaller(
      createBaseCtx({
        session: { id: "s1" },
        user: { id: "u1", role: "user" },
      })
    );

    await expect(caller.ping()).resolves.toBe("u1");
  });

  test("adminProcedure rejects non-admin users", async () => {
    const testRouter = router({
      ping: adminProcedure.query(() => "ok"),
    });

    const caller = testRouter.createCaller(
      createBaseCtx({
        session: { id: "s1" },
        user: { id: "u1", role: "user" },
      })
    );

    await expect(caller.ping()).rejects.toThrow(
      "You must be an admin to perform this action"
    );
  });

  test("adminProcedure allows admin users", async () => {
    const testRouter = router({
      ping: adminProcedure.query(({ ctx }) => ctx.user.role),
    });

    const caller = testRouter.createCaller(
      createBaseCtx({
        session: { id: "s1" },
        user: { id: "u1", role: "admin" },
      })
    );

    await expect(caller.ping()).resolves.toBe("admin");
  });
});
