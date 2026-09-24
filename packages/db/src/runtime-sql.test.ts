import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.join(import.meta.dirname, "..");
const forbiddenRuntimeSql = [
  ["prisma", ".raw"].join(""),
  ["db", ".raw"].join(""),
  [".runtime", "().query"].join(""),
  [".runtime", "().execute"].join(""),
  ["$", "queryRaw"].join(""),
  ["$", "executeRaw"].join(""),
];

async function listRuntimeTypeScriptFiles(
  directory: string
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (["generated", "migrations", "node_modules"].includes(entry.name)) {
          return [];
        }
        return listRuntimeTypeScriptFiles(filePath);
      }
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
        ? [filePath]
        : [];
    })
  );
  return files.flat();
}

describe("runtime SQL policy", () => {
  test("runtime TypeScript uses only ORM client surfaces", async () => {
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
