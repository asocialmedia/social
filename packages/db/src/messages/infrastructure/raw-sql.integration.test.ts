import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { keys, prisma } from "@asm/db";

import { closeMessageSearchPool } from "../search/search-index";
import { testSql } from "../testing/test-queries";
import { rawExecute, rawQuery } from "./raw-sql";

const COMMITTED_USER_ID = `raw-sql-commit-${crypto.randomUUID()}`;
const ROLLED_BACK_USER_ID = `raw-sql-rollback-${crypto.randomUUID()}`;

beforeAll(() => {
  const databaseUrl = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== "5433" ||
    databaseUrl.pathname !== "/asocialmedia"
  ) {
    throw new Error(
      "Raw SQL integration tests require the local test database"
    );
  }
});

afterAll(async () => {
  await prisma.orm.public.Users.where((user) =>
    user.id.in([COMMITTED_USER_ID, ROLLED_BACK_USER_ID])
  ).deleteAll();
});

describe("shared Prisma 8 raw runtime", () => {
  test("decodes nullable dates, numbers, booleans, JSON, and arrays with positional binds", async () => {
    const stamp = new Date("2026-10-11T01:02:03.456Z");
    const { rows } = await rawQuery<{
      count: number;
      enabled: boolean;
      payload: { value: string };
      stamp: Date;
      missingStamp: Date | null;
      ids: number[];
      labels: string[];
      repeated: number;
    }>(
      testSql.rawRuntime.selectBindings,
      [
        stamp,
        null,
        5,
        true,
        JSON.stringify({ value: "quote'" }),
        [1, 2],
        [
          "quote'",
          "comma,",
          'double"quote',
          "back\\slash",
          "line\nbreak",
          "",
          "NULL",
        ],
      ],
      {
        count: "pg/int4@1",
        enabled: "pg/bool@1",
        ids: "pg/jsonb@1",
        labels: "pg/jsonb@1",
        missingStamp: { codecId: "pg/timestamp-temporal@1", nullable: true },
        payload: "pg/jsonb@1",
        repeated: "pg/int4@1",
        stamp: "pg/timestamp-temporal@1",
      }
    );
    expect(rows).toEqual([
      {
        count: 5,
        enabled: true,
        ids: [1, 2],
        labels: [
          "quote'",
          "comma,",
          'double"quote',
          "back\\slash",
          "line\nbreak",
          "",
          "NULL",
        ],
        missingStamp: null,
        payload: { value: "quote'" },
        repeated: 5,
        stamp,
      },
    ]);
  });

  test("commits raw writes with affected counts on the shared transaction and keeps shutdown compatibility", async () => {
    const result = await prisma.transaction(async (transaction) => {
      const insert = await rawExecute(
        testSql.rawRuntime.insertUser,
        [COMMITTED_USER_ID, `${COMMITTED_USER_ID}@example.test`],
        transaction
      );
      expect(insert.affectedRows).toBe(1);
      const update = await rawExecute(
        testSql.rawRuntime.updateUser,
        [COMMITTED_USER_ID, "Raw transaction"],
        transaction
      );
      expect(update.affectedRows).toBe(1);
      const selected = await rawQuery<{ displayName: string }>(
        testSql.rawRuntime.lockUser,
        [COMMITTED_USER_ID],
        { displayName: "pg/text@1" },
        transaction
      );
      return selected.rows[0];
    });
    expect(result).toEqual({ displayName: "Raw transaction" });
    await closeMessageSearchPool();
    expect(
      await prisma.orm.public.Users.where({ id: COMMITTED_USER_ID }).first()
    ).not.toBeNull();
  });

  test("rolls back raw writes when the transaction callback throws", async () => {
    await expect(
      prisma.transaction(async (transaction) => {
        await rawExecute(
          testSql.rawRuntime.insertUser,
          [ROLLED_BACK_USER_ID, `${ROLLED_BACK_USER_ID}@example.test`],
          transaction
        );
        throw new Error("Rollback fixture");
      })
    ).rejects.toThrow("Rollback fixture");
    expect(
      await prisma.orm.public.Users.where({ id: ROLLED_BACK_USER_ID }).first()
    ).toBeNull();
  });

  test("sets repeatable-read and read-only before the first snapshot query", async () => {
    const settings = await prisma.transaction(async (transaction) => {
      await rawExecute(testSql.rawRuntime.setIsolation, [], transaction);
      const selected = await rawQuery<{ isolation: string; readOnly: string }>(
        testSql.rawRuntime.selectSettings,
        [],
        { isolation: "pg/text@1", readOnly: "pg/text@1" },
        transaction
      );
      return selected.rows[0];
    });
    expect(settings).toEqual({ isolation: "repeatable read", readOnly: "on" });
  });
});
