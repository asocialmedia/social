import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { closePrisma, prisma } from "@asm/db";
import type { BetterAuthOptions } from "better-auth";
import { jwt } from "better-auth/plugins";

import { prismaAdapter } from "./prisma-adapter";

const adapter = prismaAdapter(prisma)({
  plugins: [jwt()],
} as BetterAuthOptions);
const suffix = randomUUID();
const firstBranchKey = `adapter-or-a1-${suffix}`;
const firstBranchNextKey = `adapter-or-a2-${suffix}`;
const secondBranchKey = `adapter-or-b1-${suffix}`;
const secondBranchNextKey = `adapter-or-b2-${suffix}`;
const keyIds = [
  `adapter-or-a1-id-${suffix}`,
  `adapter-or-a2-id-${suffix}`,
  `adapter-or-b1-id-${suffix}`,
  `adapter-or-b2-id-${suffix}`,
];

beforeAll(async () => {
  await Promise.all([
    prisma.orm.public.Jwks.create({
      alg: "TEST",
      id: keyIds[0],
      privateKey: "private-a1",
      publicKey: firstBranchKey,
    }),
    prisma.orm.public.Jwks.create({
      alg: "TEST",
      id: keyIds[1],
      privateKey: "private-a2",
      publicKey: firstBranchNextKey,
    }),
    prisma.orm.public.Jwks.create({
      alg: "TEST",
      id: keyIds[2],
      privateKey: "private-b1",
      publicKey: secondBranchKey,
    }),
    prisma.orm.public.Jwks.create({
      alg: "TEST",
      id: keyIds[3],
      privateKey: "private-b2",
      publicKey: secondBranchNextKey,
    }),
  ]);
});

afterAll(async () => {
  await prisma.orm.public.Jwks.where((jwks) =>
    jwks.id.in(keyIds)
  ).deleteAndCount();
  await closePrisma();
});

describe("Prisma 8 Better Auth adapter", () => {
  test("supports the Better Auth JWKS model", async () => {
    const rows = await adapter.findMany({
      limit: 1,
      model: "jwks",
      where: [],
    });

    expect(Array.isArray(rows)).toBe(true);
  });

  test("preserves an explicit zero limit", async () => {
    const rows = await adapter.findMany({
      limit: 0,
      model: "jwks",
      where: [],
    });

    expect(rows).toEqual([]);
  });

  test("applies limit and offset after combining OR branches", async () => {
    const firstPage = await adapter.findMany<{ publicKey: string }>({
      limit: 1,
      model: "jwks",
      offset: 0,
      sortBy: { direction: "asc", field: "publicKey" },
      where: [
        {
          connector: "AND",
          field: "alg",
          operator: "eq",
          value: "TEST",
        },
        {
          connector: "OR",
          field: "publicKey",
          operator: "in",
          value: [firstBranchKey, firstBranchNextKey],
        },
        {
          connector: "OR",
          field: "publicKey",
          operator: "in",
          value: [secondBranchKey, secondBranchNextKey],
        },
      ],
    });
    const secondPage = await adapter.findMany<{ publicKey: string }>({
      limit: 1,
      model: "jwks",
      offset: 1,
      sortBy: { direction: "asc", field: "publicKey" },
      where: [
        {
          connector: "AND",
          field: "alg",
          operator: "eq",
          value: "TEST",
        },
        {
          connector: "OR",
          field: "publicKey",
          operator: "in",
          value: [firstBranchKey, firstBranchNextKey],
        },
        {
          connector: "OR",
          field: "publicKey",
          operator: "in",
          value: [secondBranchKey, secondBranchNextKey],
        },
      ],
    });

    expect(firstPage).toEqual([
      expect.objectContaining({ publicKey: firstBranchKey }),
    ]);
    expect(secondPage).toEqual([
      expect.objectContaining({ publicKey: firstBranchNextKey }),
    ]);
  });
});
