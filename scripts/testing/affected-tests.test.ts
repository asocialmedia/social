import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  readTestWorkspaces,
  selectAffectedTests,
  type TestWorkspace,
} from "./affected-tests";

const workspaces: TestWorkspace[] = [
  { dependencies: [], directory: "packages/base", name: "@asm/base" },
  {
    dependencies: ["@asm/base"],
    directory: "packages/domain",
    name: "@asm/domain",
  },
  { dependencies: ["@asm/domain"], directory: "apps/web", name: "@asm/web" },
  { dependencies: [], directory: "apps/mobile", name: "@asm/mobile" },
];
const tests = [
  "packages/base/src/a.test.ts",
  "packages/domain/src/b.test.ts",
  "apps/web/src/c.test.ts",
  "apps/mobile/src/d.test.ts",
  "apps/mobile/scripts/metro/e.test.ts",
  "scripts/testing/runner.test.ts",
  ".github/scripts/matrix.test.ts",
  "packages/db/src/runtime-sql.test.ts",
];
const tooling = tests.slice(5);

describe("affected unit test selection", () => {
  test("an app change includes its tests and cross-workspace tooling checks", () => {
    expect(
      selectAffectedTests(["apps/web/src/page.ts"], tests, workspaces)
    ).toEqual([tests[2], ...tooling]);
  });

  test("a shared change includes direct and transitive dependents", () => {
    expect(
      selectAffectedTests(["packages/base/src/a.ts"], tests, workspaces)
    ).toEqual([...tests.slice(0, 3), ...tooling]);
  });

  test("deleted modules still select their owning workspace", () => {
    expect(
      selectAffectedTests(["apps/web/src/deleted.ts"], tests, workspaces)
    ).toContain(tests[2]);
  });

  test("normalizes paths and keeps workspaces with similar prefixes separate", () => {
    expect(
      selectAffectedTests([".\\apps\\web\\src\\page.ts"], tests, workspaces)
    ).toEqual([tests[2], ...tooling]);
    expect(
      selectAffectedTests(["apps/web-extra/src/a.ts"], tests, workspaces)
    ).toEqual(tests);
  });

  test("root config, lockfile, test tooling, and unknown changes run all unit tests", () => {
    for (const changed of [
      "bun.lock",
      "package.json",
      "tsconfig.json",
      "scripts/testing/run-tests.ts",
      "patches/runtime.patch",
      "packages/deleted/a.ts",
    ]) {
      expect(selectAffectedTests([changed], tests, workspaces)).toEqual(tests);
    }
  });

  test("CI changes select build tooling tests", () => {
    expect(
      selectAffectedTests([".github/workflows/ci.yml"], tests, workspaces)
    ).toEqual([tests[4], ...tooling]);
  });

  test("documentation-only pushes and empty lists do not run tests", () => {
    expect(
      selectAffectedTests(
        ["apps/web/README.md", "AGENTS.md"],
        tests,
        workspaces
      )
    ).toEqual([]);
    expect(selectAffectedTests([], tests, workspaces)).toEqual([]);
  });
});

let sandbox: string | undefined;
afterEach(async () => {
  if (sandbox) {
    await rm(sandbox, { recursive: true, force: true });
    sandbox = undefined;
  }
});

test("reads dependency kinds from real workspace manifests and ignores folders without manifests", async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), "asm-affected-tests-"));
  await Promise.all(
    ["apps/web", "packages/base", "packages/empty"].map((directory) =>
      mkdir(path.join(sandbox!, directory), { recursive: true })
    )
  );
  await Bun.write(
    path.join(sandbox, "packages/base/package.json"),
    JSON.stringify({ name: "@asm/base" })
  );
  await Bun.write(
    path.join(sandbox, "apps/web/package.json"),
    JSON.stringify({
      name: "@asm/web",
      dependencies: { "@asm/base": "workspace:*" },
      devDependencies: { "@asm/tooling": "workspace:*" },
      optionalDependencies: { "@asm/optional": "workspace:*" },
      peerDependencies: { "@asm/peer": "workspace:*" },
    })
  );
  expect(await readTestWorkspaces(sandbox)).toEqual([
    {
      directory: "apps/web",
      name: "@asm/web",
      dependencies: ["@asm/base", "@asm/tooling", "@asm/optional", "@asm/peer"],
    },
    { directory: "packages/base", name: "@asm/base", dependencies: [] },
  ]);
});
