import { describe, expect, test } from "bun:test";

import {
  getCommentDataQuery,
  getPostDataQuery,
  getUserDataQuery,
} from "./client";
import prisma from "./prisma";

describe("db client queries", () => {
  test("creates a public user query", () => {
    const query = getUserDataQuery(prisma.orm, "user123");
    expect(query).toBeDefined();
  });

  test("creates a post query with related data", () => {
    const query = getPostDataQuery(prisma.orm, "user123");
    expect(query).toBeDefined();
  });

  test("creates a comment query with user data", () => {
    const query = getCommentDataQuery(prisma.orm, "user123");
    expect(query).toBeDefined();
  });
});
