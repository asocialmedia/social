// oxlint-disable-next-line typescript/triple-slash-reference -- The isolated deployment fixture imports SQL as text.
/// <reference path="../../packages/db/sql.d.ts" />
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { readSqlBundle, renderSql } from "@asm/db/sql-template";
import { Client } from "pg";

import markerSql from "../../docker/prisma-marker.sql" with { type: "text" };
import {
  CANONICAL_PRISMA_CHECKPOINT,
  LEGACY_PRISMA_CHECKPOINT,
} from "./prisma-checkpoint-upgrade";
import fixtureSqlSource from "./prisma-checkpoint-upgrade.fixture.sql" with { type: "text" };

const { fixture: fixtureSql } = readSqlBundle(fixtureSqlSource, {
  fixture: [
    "createDatabase",
    "dropDatabase",
    "createExtension",
    "updateMarker",
    "renameColumn",
    "restoreColumn",
  ],
} as const);

const databaseUrl = process.env.DATABASE_URL;
const localDatabase =
  databaseUrl &&
  ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname);

test.skipIf(!localDatabase)(
  "the live-schema guard normalizes the legacy marker, applies pending DDL, and refuses drift",
  async () => {
    if (!databaseUrl) throw new Error("A local test database is required");
    const name = `asm_prisma_upgrade_${randomUUID().replaceAll("-", "")}`;
    const targetUrl = new URL(databaseUrl);
    targetUrl.pathname = `/${name}`;
    const admin = new Client({ connectionString: databaseUrl });
    const target = new Client({ connectionString: targetUrl.toString() });
    const root = path.resolve(import.meta.dir, "../..");
    async function run(
      args: string[]
    ): Promise<{ code: number; output: string }> {
      const child = Bun.spawn([process.execPath, ...args], {
        cwd: path.join(root, "packages/db"),
        env: { ...process.env, DATABASE_URL: targetUrl.toString() },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { code, output: stdout + stderr };
    }
    await admin.connect();
    try {
      await admin.query(renderSql(fixtureSql.createDatabase, { name }));
      await target.connect();
      const fresh = await run([
        path.join(root, "scripts/maintenance/prisma-checkpoint-upgrade.ts"),
      ]);
      expect(fresh.code).toBe(0);
      for (const extension of [
        "pgcrypto",
        "pg_stat_statements",
        "pg_trgm",
        "uuid-ossp",
      ]) {
        await target.query(
          renderSql(fixtureSql.createExtension, { extension })
        );
      }
      const initialized = await run([
        "x",
        "prisma",
        "db",
        "migrate",
        "--to",
        CANONICAL_PRISMA_CHECKPOINT,
      ]);
      expect(initialized.output).not.toContain('"ok":false');
      expect(initialized.code).toBe(0);
      await target.query(fixtureSql.updateMarker, [
        LEGACY_PRISMA_CHECKPOINT,
        "app",
      ]);
      await target.query(fixtureSql.renameColumn);
      const refused = await run([
        path.join(root, "scripts/maintenance/prisma-checkpoint-upgrade.ts"),
      ]);
      expect(refused.code).not.toBe(0);
      expect(refused.output).toContain("CONTRACT.SCHEMA_VERIFICATION_FAILED");
      expect(refused.output).toContain("username");
      const unchanged = await target.query<{ storageHash: string }>(markerSql, [
        "app",
      ]);
      expect(unchanged.rows[0]?.storageHash).toBe(LEGACY_PRISMA_CHECKPOINT);
      await target.query(fixtureSql.restoreColumn);
      const upgraded = await run([
        path.join(root, "scripts/maintenance/prisma-checkpoint-upgrade.ts"),
      ]);
      expect(upgraded.output).not.toContain('"ok":false');
      expect(upgraded.code).toBe(0);
      const marker = await target.query<{ storageHash: string }>(markerSql, [
        "app",
      ]);
      expect(marker.rows[0]?.storageHash).toBe(CANONICAL_PRISMA_CHECKPOINT);
      const applied = await run(["x", "prisma", "db", "migrate"]);
      expect(applied.output).not.toContain('"ok":false');
      expect(applied.code).toBe(0);
      const verified = await run(["x", "prisma", "db", "verify"]);
      expect(verified.code).toBe(0);
    } finally {
      await target.end();
      await admin.query(renderSql(fixtureSql.dropDatabase, { name }));
      await admin.end();
    }
  },
  60_000
);
