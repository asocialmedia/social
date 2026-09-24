import { beforeEach, describe, expect, test } from "bun:test";

import type { PrismaClient } from "@asm/db";
import type { BetterAuthOptions } from "better-auth";
import { jwt } from "better-auth/plugins";

import { prismaAdapter } from "./prisma-adapter";

interface FakeQuery {
  all: () => Promise<Record<string, unknown>[]>;
  limit: (value: number) => FakeQuery;
  offset: (value: number) => FakeQuery;
  orderBy: (order: (model: Record<string, unknown>) => unknown) => FakeQuery;
  select: (...fields: string[]) => FakeQuery;
  where: (predicate: (model: object) => unknown) => FakeQuery;
}

interface FakeQueryState {
  limit?: number;
  offset: number;
  rows: Record<string, unknown>[];
  whereCalls: number;
}

const rows: Record<string, unknown>[] = [
  { alg: "TEST", id: "a1", publicKey: "adapter-or-a1" },
  { alg: "TEST", id: "a2", publicKey: "adapter-or-a2" },
  { alg: "TEST", id: "b1", publicKey: "adapter-or-b1" },
  { alg: "TEST", id: "b2", publicKey: "adapter-or-b2" },
];
const state: FakeQueryState = {
  offset: 0,
  rows,
  whereCalls: 0,
};

const query: FakeQuery = {
  all: () => {
    const end =
      state.limit === undefined ? undefined : state.offset + state.limit;
    return Promise.resolve(state.rows.slice(state.offset, end));
  },
  limit: (value) => {
    state.limit = value;
    return query;
  },
  offset: (value) => {
    state.offset = value;
    return query;
  },
  orderBy: () => query,
  select: () => query,
  where: () => {
    state.whereCalls += 1;
    return query;
  },
};

const fakeClient = {
  orm: { public: { Jwks: query } },
  transaction: () => {},
} as unknown as PrismaClient;
const adapter = prismaAdapter(fakeClient)({
  plugins: [jwt()],
} as BetterAuthOptions);

beforeEach(() => {
  state.limit = undefined;
  state.offset = 0;
  state.whereCalls = 0;
});

describe("Prisma 8 Better Auth adapter", () => {
  test("supports the Better Auth JWKS model", async () => {
    const result = await adapter.findMany({
      limit: 1,
      model: "jwks",
      where: [],
    });

    expect(result).toEqual([expect.objectContaining({ id: "a1" })]);
  });

  test("preserves an explicit zero limit", async () => {
    const result = await adapter.findMany({
      limit: 0,
      model: "jwks",
      where: [],
    });

    expect(result).toEqual([]);
    expect(state.limit).toBe(0);
  });

  test("applies limit and offset after combining OR branches", async () => {
    const where = [
      {
        connector: "AND" as const,
        field: "alg",
        operator: "eq" as const,
        value: "TEST",
      },
      {
        connector: "OR" as const,
        field: "publicKey",
        operator: "in" as const,
        value: ["adapter-or-a1", "adapter-or-a2"],
      },
      {
        connector: "OR" as const,
        field: "publicKey",
        operator: "in" as const,
        value: ["adapter-or-b1", "adapter-or-b2"],
      },
    ];
    const firstPage = await adapter.findMany<{ publicKey: string }>({
      limit: 1,
      model: "jwks",
      offset: 0,
      sortBy: { direction: "asc", field: "publicKey" },
      where,
    });

    expect(firstPage).toEqual([
      expect.objectContaining({ publicKey: "adapter-or-a1" }),
    ]);
    expect(state.whereCalls).toBe(1);

    const secondPage = await adapter.findMany<{ publicKey: string }>({
      limit: 1,
      model: "jwks",
      offset: 1,
      sortBy: { direction: "asc", field: "publicKey" },
      where,
    });

    expect(secondPage).toEqual([
      expect.objectContaining({ publicKey: "adapter-or-a2" }),
    ]);
    expect(state.whereCalls).toBe(2);
  });
});
