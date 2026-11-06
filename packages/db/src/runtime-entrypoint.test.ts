import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("the application entry point excludes deployment index preparation", async () => {
  const [runtime, cli] = await Promise.all([
    readFile(new URL("../index.ts", import.meta.url), "utf-8"),
    readFile(new URL("messages/prebuild-indexes.ts", import.meta.url), "utf-8"),
  ]);

  // Deployment SQL must not be parsed when ordinary requests import the database package.
  expect(runtime).not.toMatch(
    /(?:from|import)\s*["'][^"']*prebuild-indexes["']/u
  );
  expect(runtime).not.toContain("prebuildDmIndexes");
  expect(cli).toContain('from "./infrastructure/prebuild-indexes"');
  expect(cli).toContain("if (import.meta.main)");
});
