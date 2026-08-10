import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectTestFiles } from "./test-file-discovery";

async function ensureFile(path: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "export {}\n", "utf8");
}

describe("test-file-discovery", () => {
  let sandbox = "";

  afterEach(async () => {
    if (sandbox) {
      await rm(sandbox, { force: true, recursive: true });
      sandbox = "";
    }
  });

  test("collects tests by scope and ignores generated directories", async () => {
    sandbox = await mkdtemp(join(tmpdir(), "asm-test-discovery-"));

    await ensureFile(join(sandbox, "apps", "auth", "alpha.test.ts"));
    await ensureFile(join(sandbox, "apps", "auth", "beta.integration.test.ts"));
    await ensureFile(join(sandbox, "packages", "db", "gamma.spec.ts"));
    await ensureFile(join(sandbox, "packages", "db", "delta_test_.ts"));
    await ensureFile(join(sandbox, "node_modules", "x", "ignore.test.ts"));
    await ensureFile(join(sandbox, "coverage", "ignore.spec.ts"));
    await ensureFile(join(sandbox, ".next", "ignore.test.ts"));

    const all = await collectTestFiles("all", sandbox);
    const unit = await collectTestFiles("unit", sandbox);
    const integration = await collectTestFiles("integration", sandbox);

    expect(all).toEqual([
      "apps/auth/alpha.test.ts",
      "apps/auth/beta.integration.test.ts",
      "packages/db/delta_test_.ts",
      "packages/db/gamma.spec.ts",
    ]);

    expect(unit).toEqual([
      "apps/auth/alpha.test.ts",
      "packages/db/delta_test_.ts",
      "packages/db/gamma.spec.ts",
    ]);

    expect(integration).toEqual(["apps/auth/beta.integration.test.ts"]);
  });
});
