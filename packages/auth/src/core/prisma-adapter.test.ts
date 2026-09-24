import { describe, expect, test } from "bun:test";

import { closePrisma, prisma } from "@asm/db";
import type { BetterAuthOptions } from "better-auth";
import { jwt } from "better-auth/plugins";

import { prismaAdapter } from "./prisma-adapter";

describe("Prisma 8 Better Auth adapter", () => {
  test("supports the Better Auth JWKS model", async () => {
    const adapter = prismaAdapter(prisma)({
      plugins: [jwt()],
    } as BetterAuthOptions);
    const rows = await adapter.findMany({
      limit: 1,
      model: "jwks",
      where: [],
    });

    expect(Array.isArray(rows)).toBe(true);
    await closePrisma();
  });
});
