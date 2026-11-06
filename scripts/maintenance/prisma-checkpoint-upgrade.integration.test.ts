import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { Client } from "pg";

import {
  CANONICAL_PRISMA_CHECKPOINT,
  LEGACY_PRISMA_CHECKPOINT,
} from "./prisma-checkpoint-upgrade";

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
      await admin.query(`CREATE DATABASE "${name}"`);
      await target.connect();
      for (const extension of [
        "pgcrypto",
        "pg_stat_statements",
        "pg_trgm",
        "uuid-ossp",
      ]) {
        await target.query(`CREATE EXTENSION IF NOT EXISTS "${extension}"`);
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
      await target.query(
        "UPDATE prisma_contract.marker SET core_hash=$1 WHERE space=$2",
        [LEGACY_PRISMA_CHECKPOINT, "app"]
      );
      const upgraded = await run([
        path.join(root, "scripts/maintenance/prisma-checkpoint-upgrade.ts"),
      ]);
      expect(upgraded.output).not.toContain('"ok":false');
      expect(upgraded.code).toBe(0);
      const marker = await target.query<{ core_hash: string }>(
        "SELECT core_hash FROM prisma_contract.marker WHERE space=$1",
        ["app"]
      );
      expect(marker.rows[0]?.core_hash).toBe(CANONICAL_PRISMA_CHECKPOINT);
      const applied = await run(["x", "prisma", "db", "migrate"]);
      expect(applied.output).not.toContain('"ok":false');
      expect(applied.code).toBe(0);
      const verified = await run(["x", "prisma", "db", "verify"]);
      expect(verified.code).toBe(0);
      await target.query(
        "ALTER TABLE public.users RENAME COLUMN username TO broken_username"
      );
      await target.query(
        "UPDATE prisma_contract.marker SET core_hash=$1 WHERE space=$2",
        [LEGACY_PRISMA_CHECKPOINT, "app"]
      );
      const refused = await run([
        path.join(root, "scripts/maintenance/prisma-checkpoint-upgrade.ts"),
      ]);
      expect(refused.code).not.toBe(0);
      const unchanged = await target.query<{ core_hash: string }>(
        "SELECT core_hash FROM prisma_contract.marker WHERE space=$1",
        ["app"]
      );
      expect(unchanged.rows[0]?.core_hash).toBe(LEGACY_PRISMA_CHECKPOINT);
    } finally {
      await target.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    }
  },
  60_000
);
