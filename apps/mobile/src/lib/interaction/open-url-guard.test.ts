import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SOURCE_ROOT = path.join(import.meta.dir, "..", "..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const entry = path.join(directory, name);
    if (statSync(entry).isDirectory()) {
      return sourceFiles(entry);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [entry] : [];
  });
}

// A fire-and-forget Linking.openURL turns "no app can open this" into an
// unhandled rejection. External links go through openExternalUrl instead.
test("no source file fires Linking.openURL without handling the rejection", () => {
  const offenders = sourceFiles(SOURCE_ROOT).filter((entry) =>
    /void\s+Linking\.openURL\(/.test(readFileSync(entry, "utf-8"))
  );
  expect(offenders).toEqual([]);
});
