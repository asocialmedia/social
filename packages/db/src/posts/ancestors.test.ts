import { describe, expect, test } from "bun:test";

import prisma from "../prisma";
import { getPostAncestors } from "./ancestors";

describe("getPostAncestors", () => {
  test("returns empty array when no parent exists", async () => {
    const result = await getPostAncestors("", "user-1");
    expect(result).toEqual([]);
  });

  test("returns ordered ancestors via CTE query", async () => {
    const originalQueryRaw = prisma.$queryRaw;
    const originalFindMany = prisma.post.findMany;
    const prismaAny = prisma as unknown as {
      $queryRaw: unknown;
      post: { findMany: unknown };
    };

    try {
      // Simulate CTE returning root then parent (ORDER BY depth DESC)
      prismaAny.$queryRaw = () => [{ id: "root" }, { id: "parent" }];
      prismaAny.post.findMany = () => [
        { aura: 0, id: "parent", viewCount: 5 },
        { aura: 0, id: "root", viewCount: 10 },
      ];

      const result = await getPostAncestors("parent", "user-1");
      expect(result.map((p) => p.id)).toEqual(["root", "parent"]);
    } finally {
      prisma.$queryRaw = originalQueryRaw;
      prisma.post.findMany = originalFindMany;
    }
  });

  test("falls back to sequential loop when raw CTE query fails", async () => {
    const originalQueryRaw = prisma.$queryRaw;
    const originalFindUnique = prisma.post.findUnique;
    const originalFindMany = prisma.post.findMany;
    const prismaAny = prisma as unknown as {
      $queryRaw: unknown;
      post: { findMany: unknown; findUnique: unknown };
    };

    try {
      // Force CTE failure
      prismaAny.$queryRaw = () => {
        throw new Error("CTE unsupported in test");
      };

      // Loop queries: parent -> root -> null
      prismaAny.post.findUnique = ({ where }: { where: { id: string } }) => {
        if (where.id === "parent") {
          return { parentPostId: "root" };
        }
        return { parentPostId: null };
      };

      prismaAny.post.findMany = () => [
        { aura: 0, id: "parent", viewCount: 1 },
        { aura: 0, id: "root", viewCount: 2 },
      ];

      const result = await getPostAncestors("parent", "user-1");
      expect(result.map((p) => p.id)).toEqual(["root", "parent"]);
    } finally {
      prisma.$queryRaw = originalQueryRaw;
      prisma.post.findUnique = originalFindUnique;
      prisma.post.findMany = originalFindMany;
    }
  });
});
