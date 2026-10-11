import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.join(import.meta.dirname, "..");
const forbiddenRuntimeSql = [
  ["@prisma", "/client"].join(""),
  ["$", "queryRaw"].join(""),
  ["$", "executeRaw"].join(""),
];

async function listRuntimeTypeScriptFiles(
  directory: string,
  includeTests = false
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name.startsWith(".") ||
          [
            "generated",
            "migrations",
            "node_modules",
            "build",
            "dist",
            "coverage",
          ].includes(entry.name)
        ) {
          return [];
        }
        return listRuntimeTypeScriptFiles(filePath, includeTests);
      }
      return /\.tsx?$/u.test(entry.name) &&
        (includeTests || !/\.test\.tsx?$/u.test(entry.name))
        ? [filePath]
        : [];
    })
  );
  return files.flat();
}

describe("runtime SQL policy", () => {
  test("message search keeps SQL statements in text imports and uses the shared client", async () => {
    const sources = await Promise.all(
      ["search/search-index.ts", "epochs/epoch-readability.ts"].map(
        (filename) =>
          readFile(path.join(packageRoot, "src", "messages", filename), "utf-8")
      )
    );
    for (const source of sources) {
      expect(source).not.toMatch(
        /["'`]\s*(?:SELECT|WITH|INSERT\s+INTO|UPDATE|DELETE\s+FROM|SET\s+(?:LOCAL|TRANSACTION))\b/u
      );
      expect(source).not.toMatch(/from\s+["']pg["']|new\s+Pool\(/u);
    }
  });

  test("authored SQL outside migrations lives in imported bundles, with a standalone prebuild client", async () => {
    const repositoryRoot = path.join(packageRoot, "..", "..");
    const fileGroups = await Promise.all(
      ["packages", "apps", "scripts", "docker"].map((directory) =>
        listRuntimeTypeScriptFiles(path.join(repositoryRoot, directory), true)
      )
    );
    const files = fileGroups.flat();
    // These unit tests build synthetic plans and templates without executing SQL.
    const syntheticSqlTests = new Set([
      "packages/db/src/messages/infrastructure/raw-sql.test.ts",
      "packages/db/src/messages/infrastructure/sql-template.test.ts",
    ]);
    const violationGroups = await Promise.all(
      files.map(async (file) => {
        const filename = path.relative(repositoryRoot, file);
        const source = await readFile(file, "utf-8");
        const failures: string[] = [];
        if (
          !syntheticSqlTests.has(filename) &&
          /["'`]\s*(?:SELECT|WITH|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP\s+)?(?:UNIQUE\s+)?(?:TABLE|INDEX|FUNCTION|SEQUENCE|TRIGGER)|DROP\s+(?:TABLE|INDEX|FUNCTION|SEQUENCE|TRIGGER)|ANALYZE|SET\s+(?:LOCAL|TRANSACTION))\s+\S/u.test(
            source
          )
        ) {
          failures.push(`${filename}:inline SQL statement`);
        }
        if (
          filename !==
            "packages/db/src/messages/infrastructure/prebuild-indexes.ts" &&
          /from\s+["']pg["']|new\s+Pool\(/u.test(source)
        ) {
          failures.push(`${filename}:independent Postgres client`);
        }
        return failures;
      })
    );
    const violations = violationGroups.flat();
    expect(violations).toEqual([]);
  });

  test("runtime TypeScript allows Prisma 8 lanes and forbids Prisma 7 APIs", async () => {
    const files = await listRuntimeTypeScriptFiles(packageRoot);
    const violations = await Promise.all(
      files.map(async (file) => {
        const source = await readFile(file, "utf-8");
        return forbiddenRuntimeSql
          .filter((forbidden) => source.includes(forbidden))
          .map(
            (forbidden) => `${file.slice(packageRoot.length + 1)}:${forbidden}`
          );
      })
    );

    expect(violations.flat()).toEqual([]);
  });
});
