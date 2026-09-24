import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

// oxlint-disable promise/prefer-await-to-callbacks -- Prisma interactive transactions require a callback.

const USER = { id: "user-1", username: "oldhandle" };
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface Alias {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  userId: string;
  username: string;
}

const state = {
  aliases: [] as Alias[],
  currentUsername: USER.username,
  otherUsernames: new Set<string>(),
  session: { user: USER } as { user: typeof USER } | null,
};

function equalIgnoreCase(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function resetState() {
  state.aliases = [];
  state.currentUsername = USER.username;
  state.otherUsernames = new Set();
  state.session = { user: USER };
}

const mockPrisma = {
  $transaction: async <T>(
    callback: (transaction: typeof mockTransaction) => Promise<T>
  ): Promise<T> => await callback(mockTransaction),
  transaction: async <T>(
    callback: (transaction: typeof mockTransaction) => Promise<T>
  ): Promise<T> => await callback(mockTransaction),
};

function createUsernameOrm() {
  return {
    UsernameAliases: {
      create: (data: Record<string, unknown>) =>
        mockTransaction.usernameAlias.create({
          data: data as Omit<Alias, "createdAt" | "id">,
        }),
      select: () => ({
        where: (
          where: Record<string, unknown> | ((value: unknown) => unknown)
        ) => createAliasSelection(where),
      }),
      where: (
        where: Record<string, unknown> | ((value: unknown) => unknown)
      ) => {
        if (typeof where !== "function") {
          return {
            delete: () =>
              mockTransaction.usernameAlias.delete({
                where: where as { id: string },
              }),
          };
        }
        let expiresAt = new Date(0);
        let username = "";
        where({
          expiresAt: { lte: (value: Date) => (expiresAt = value) },
          username: { ilike: (value: string) => (username = value) },
        });
        return {
          delete: () =>
            mockTransaction.usernameAlias.deleteMany({
              where: {
                expiresAt: { lte: expiresAt },
                username: { equals: username },
              },
            }),
        };
      },
    },
    Users: {
      select: () => ({
        where: (
          where: Record<string, unknown> | ((value: unknown) => unknown)
        ) => {
          if (typeof where === "function") {
            let username = "";
            where({
              username: { ilike: (value: string) => (username = value) },
            });
            return {
              first: () =>
                mockTransaction.user.findFirst({
                  where: { username: { equals: username } },
                }),
            };
          }
          return { first: () => mockTransaction.user.findUnique() };
        },
      }),
      where: () => ({
        update: (data: { username: string }) =>
          mockTransaction.user.update({ data }),
      }),
    },
  };
}

function createAliasSelection(
  where: Record<string, unknown> | ((value: unknown) => unknown)
) {
  if (typeof where !== "function") {
    return {
      first: () =>
        mockTransaction.usernameAlias.findFirst({
          where: {
            expiresAt: { gt: new Date(0) },
            username: {
              equals: String((where as { username?: string }).username ?? ""),
            },
          },
        }),
    };
  }
  let since = new Date(0);
  let expiresAt = new Date(0);
  let userId = "";
  let username = "";
  where({
    createdAt: { gte: (value: Date) => (since = value) },
    expiresAt: { gt: (value: Date) => (expiresAt = value) },
    userId: { eq: (value: string) => (userId = value) },
    username: { ilike: (value: string) => (username = value) },
  });
  const query = {
    all: () =>
      mockTransaction.usernameAlias.findMany({
        where: { createdAt: { gte: since }, userId },
      }),
    first: () =>
      mockTransaction.usernameAlias.findFirst({
        where: { expiresAt: { gt: expiresAt }, username: { equals: username } },
      }),
    limit: (limit: number) => ({
      all: () =>
        mockTransaction.usernameAlias
          .findMany({ where: { createdAt: { gte: since }, userId } })
          .slice(0, limit),
    }),
    orderBy: () => query,
  };
  return query;
}

const mockTransaction = {
  orm: { public: createUsernameOrm() },
  user: {
    findFirst: ({ where }: { where: { username: { equals: string } } }) => {
      const requestedUsername = where.username.equals;
      if (equalIgnoreCase(requestedUsername, state.currentUsername)) {
        return { id: USER.id };
      }
      return state.otherUsernames.has(requestedUsername.toLowerCase())
        ? { id: "other-user" }
        : null;
    },
    findUnique: () => ({ id: USER.id, username: state.currentUsername }),
    update: ({ data }: { data: { username: string } }) => {
      state.currentUsername = data.username;
      return { id: USER.id, username: data.username };
    },
  },
  usernameAlias: {
    create: ({ data }: { data: Omit<Alias, "createdAt" | "id"> }) => {
      state.aliases.push({
        ...data,
        createdAt: new Date(),
        id: `alias-${state.aliases.length + 1}`,
      });
      return state.aliases.at(-1);
    },
    delete: ({ where }: { where: { id: string } }) => {
      state.aliases = state.aliases.filter((alias) => alias.id !== where.id);
      return {};
    },
    deleteMany: ({
      where,
    }: {
      where: { expiresAt: { lte: Date }; username: { equals: string } };
    }) => {
      const before = state.aliases.length;
      state.aliases = state.aliases.filter(
        (alias) =>
          !(
            equalIgnoreCase(alias.username, where.username.equals) &&
            alias.expiresAt <= where.expiresAt.lte
          )
      );
      return { count: before - state.aliases.length };
    },
    findFirst: ({
      where,
    }: {
      where: { expiresAt: { gt: Date }; username: { equals: string } };
    }) =>
      state.aliases.find(
        (alias) =>
          equalIgnoreCase(alias.username, where.username.equals) &&
          alias.expiresAt > where.expiresAt.gt
      ) ?? null,
    findMany: ({
      where,
    }: {
      where: { createdAt: { gte: Date }; userId: string };
    }) =>
      state.aliases
        .filter(
          (alias) =>
            alias.userId === where.userId &&
            alias.createdAt >= where.createdAt.gte
        )
        .toSorted(
          (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
        )
        .slice(0, 5),
  },
};

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  Prisma: {
    PrismaClientKnownRequestError: class PrismaKnownError extends Error {
      code = "";
      name = "PrismaKnownError";
    },
    TransactionIsolationLevel: { Serializable: "Serializable" },
  },
  USERNAME_CHANGE_LIMIT: 5,
  getUsernameAliasExpiry: (now: Date) =>
    new Date(now.getTime() + THIRTY_DAYS_MS),
  getUsernameChangeWindowStart: (now: Date) =>
    new Date(now.getTime() - THIRTY_DAYS_MS),
  isReservedUsername: (username: string) => username.toLowerCase() === "zeph",
  prisma: mockPrisma,
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => state.session,
}));

const { PATCH } = await import("./route");

function patchRequest(username: string): Request {
  return new Request("http://localhost/api/users/username", {
    body: JSON.stringify({ username }),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
}

function createAlias({
  expiresAt = new Date(Date.now() + THIRTY_DAYS_MS),
  userId = USER.id,
  username,
}: {
  expiresAt?: Date;
  userId?: string;
  username: string;
}) {
  state.aliases.push({
    createdAt: new Date(),
    expiresAt,
    id: `alias-${state.aliases.length + 1}`,
    userId,
    username,
  });
}

describe("PATCH /api/users/username", () => {
  beforeEach(resetState);

  test("rejects unauthenticated requests", async () => {
    state.session = null;

    const response = await PATCH(patchRequest("newhandle"));

    expect(response.status).toBe(401);
  });

  test("reserves the previous username for 30 days", async () => {
    const response = await PATCH(patchRequest("newhandle"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      changed: true,
      success: true,
      username: "newhandle",
    });
    expect(state.currentUsername).toBe("newhandle");
    expect(state.aliases).toHaveLength(1);
    expect(state.aliases[0]).toMatchObject({
      userId: USER.id,
      username: "oldhandle",
    });
    expect(state.aliases[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  test("does not allow someone else to claim an active alias", async () => {
    createAlias({ userId: "other-user", username: "formerhandle" });

    const response = await PATCH(patchRequest("FormerHandle"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Username is already taken",
    });
  });

  test("allows an expired alias to be claimed", async () => {
    createAlias({
      expiresAt: new Date(Date.now() - 1000),
      userId: "other-user",
      username: "releasedhandle",
    });

    const response = await PATCH(patchRequest("releasedhandle"));

    expect(response.status).toBe(200);
    expect(state.currentUsername).toBe("releasedhandle");
  });

  test("lets the owner reclaim an active prior username", async () => {
    state.currentUsername = "newhandle";
    createAlias({ username: "oldhandle" });

    const response = await PATCH(patchRequest("oldhandle"));

    expect(response.status).toBe(200);
    expect(state.currentUsername).toBe("oldhandle");
    expect(state.aliases.map((alias) => alias.username)).toEqual(["newhandle"]);
  });

  test("limits each account to five username changes in 30 days", async () => {
    for (let index = 0; index < 5; index += 1) {
      createAlias({ username: `oldhandle${index}` });
    }

    const response = await PATCH(patchRequest("newhandle"));

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: "You can change your username up to 5 times every 30 days.",
    });
  });

  test("rejects reserved and invalid usernames", async () => {
    const reservedResponse = await PATCH(patchRequest("zeph"));
    const invalidResponse = await PATCH(patchRequest("bad name!"));

    expect(reservedResponse.status).toBe(400);
    expect(invalidResponse.status).toBe(400);
  });
});
