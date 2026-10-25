import { expect, test } from "bun:test";

import { isUniqueConstraintViolation } from "./database-errors";

test("recognizes Prisma 8 SQLSTATE and wrapped PostgreSQL uniqueness errors", () => {
  expect(isUniqueConstraintViolation({ sqlState: "23505" })).toBe(true);
  expect(
    isUniqueConstraintViolation(
      new Error("query failed", { cause: { code: "23505" } })
    )
  ).toBe(true);
  expect(isUniqueConstraintViolation({ code: "23505" })).toBe(true);
  expect(isUniqueConstraintViolation({ code: "P2002" })).toBe(true);
});

test("does not hide connection, authorization, or other constraint failures", () => {
  for (const error of [
    null,
    "23505",
    { sqlState: "23503" },
    { code: "ECONNREFUSED" },
    { sqlState: "42501" },
  ]) {
    expect(isUniqueConstraintViolation(error)).toBe(false);
  }
  const cyclic = { cause: {} };
  cyclic.cause = cyclic;
  expect(isUniqueConstraintViolation(cyclic)).toBe(false);
});
