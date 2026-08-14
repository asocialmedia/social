import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  bumpPatchVersion,
  determineChangedPackages,
  hasRootChanges,
  runBumpVersions,
  runBumpVersionWithContext,
} from "./bump-versions-lib";
import type { PackageJson } from "./bump-versions-lib";

async function writePackageJson(filePath: string, pkg: PackageJson) {
  await writeFile(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function readVersion(filePath: string) {
  const content = await readFile(filePath, "utf-8");
  return (JSON.parse(content) as PackageJson).version;
}

describe("bumpPatchVersion", () => {
  test("increments patch version", () => {
    expect(bumpPatchVersion("1.2.3")).toBe("1.2.4");
  });

  test("rolls patch at 99", () => {
    expect(bumpPatchVersion("1.2.99")).toBe("1.3.0");
  });

  test("rolls middle at 99", () => {
    expect(bumpPatchVersion("1.99.99")).toBe("2.0.0");
  });

  test("throws on invalid version format", () => {
    expect(() => bumpPatchVersion("1.2")).toThrow(
      "Invalid version format: 1.2"
    );
    expect(() => bumpPatchVersion("abc")).toThrow(
      "Invalid version format: abc"
    );
  });
});

describe("determineChangedPackages", () => {
  test("collects unique app and package names", () => {
    const stagedFiles = [
      "packages/ui/src/button.tsx",
      "packages/ui/package.json",
      "packages/db/prisma/schema.prisma",
      "apps/web/src/app/page.tsx",
      "apps/auth/src/index.ts",
      "docker/docker-compose.dev.yml",
    ];

    const changed = determineChangedPackages(stagedFiles);

    expect([...changed].toSorted()).toEqual(["auth", "db", "ui", "web"]);
  });
});

describe("hasRootChanges", () => {
  test("returns false for apps and packages only", () => {
    expect(
      hasRootChanges(["apps/web/src/app/page.tsx", "packages/db/src/index.ts"])
    ).toBe(false);
  });

  test("returns true when root-level or infra files are staged", () => {
    expect(
      hasRootChanges([
        "apps/web/src/app/page.tsx",
        "docker/docker-compose.dev.yml",
      ])
    ).toBe(true);
  });
});

describe("runBumpVersionWithContext", () => {
  let sandboxDir = "";
  let stagedFiles = new Set<string>();
  let stagedByScript = new Set<string>();

  beforeEach(async () => {
    if (sandboxDir) {
      await rm(sandboxDir, { force: true, recursive: true });
    }

    sandboxDir = await mkdtemp(path.join(tmpdir(), "asm-bump-script-"));
    await mkdir(path.join(sandboxDir, "apps", "web"), { recursive: true });
    await mkdir(path.join(sandboxDir, "apps", "docs"), { recursive: true });
    await mkdir(path.join(sandboxDir, "packages", "db"), { recursive: true });

    await writePackageJson(path.join(sandboxDir, "package.json"), {
      name: "root",
      version: "1.0.1",
    });
    await writePackageJson(
      path.join(sandboxDir, "apps", "web", "package.json"),
      {
        name: "web",
        version: "1.0.1",
      }
    );
    await writePackageJson(
      path.join(sandboxDir, "apps", "docs", "package.json"),
      {
        name: "docs",
        version: "0.0.1",
      }
    );
    await writePackageJson(
      path.join(sandboxDir, "packages", "db", "package.json"),
      {
        name: "db",
        version: "1.0.1",
      }
    );

    stagedFiles = new Set<string>();
    stagedByScript = new Set<string>();
  });

  afterEach(async () => {
    if (sandboxDir) {
      await rm(sandboxDir, { force: true, recursive: true });
      sandboxDir = "";
    }
  });

  test("skips missing workspace package.json files", async () => {
    stagedFiles = new Set(["apps/auth/src/index.ts"]);

    await runBumpVersionWithContext({
      fileExists: (pkgPath) =>
        Bun.file(path.join(sandboxDir, pkgPath)).exists(),
      getStagedFiles: () => Promise.resolve([...stagedFiles]),
      readPackageJson: async (pkgPath) =>
        JSON.parse(
          await readFile(path.join(sandboxDir, pkgPath), "utf-8")
        ) as PackageJson,
      stageFile: (filePath) => {
        stagedByScript.add(filePath);
        return Promise.resolve();
      },
      writePackageJson: async (pkgPath, pkg) => {
        await writeFile(
          path.join(sandboxDir, pkgPath),
          `${JSON.stringify(pkg, null, 2)}\n`
        );
      },
    });

    expect(await readVersion(path.join(sandboxDir, "package.json"))).toBe(
      "1.0.2"
    );
    expect(stagedByScript.has("apps/auth/package.json")).toBe(false);
    expect(stagedByScript.has("package.json")).toBe(true);
  });

  test("bumps root and changed workspaces when files are staged", async () => {
    stagedFiles = new Set([
      "docker/docker-compose.dev.yml",
      "apps/web/src/app/page.tsx",
      "packages/db/src/index.ts",
    ]);

    await runBumpVersionWithContext({
      fileExists: (pkgPath) => {
        const filePath = path.join(sandboxDir, pkgPath);
        return Bun.file(filePath).exists();
      },
      getStagedFiles: () => Promise.resolve([...stagedFiles]),
      readPackageJson: async (pkgPath) => {
        const content = await readFile(path.join(sandboxDir, pkgPath), "utf-8");
        return JSON.parse(content) as PackageJson;
      },
      stageFile: (filePath) => {
        stagedByScript.add(filePath);
        return Promise.resolve();
      },
      writePackageJson: async (pkgPath, pkg) => {
        await writeFile(
          path.join(sandboxDir, pkgPath),
          `${JSON.stringify(pkg, null, 2)}\n`
        );
      },
    });

    expect(await readVersion(path.join(sandboxDir, "package.json"))).toBe(
      "1.0.2"
    );
    expect(
      await readVersion(path.join(sandboxDir, "apps", "web", "package.json"))
    ).toBe("1.0.2");
    expect(
      await readVersion(path.join(sandboxDir, "packages", "db", "package.json"))
    ).toBe("1.0.2");
    expect(
      await readVersion(path.join(sandboxDir, "apps", "docs", "package.json"))
    ).toBe("0.0.1");

    expect([...stagedByScript].toSorted()).toEqual([
      "apps/web/package.json",
      "package.json",
      "packages/db/package.json",
    ]);
  });

  test("does not bump anything when no staged files are present", async () => {
    await runBumpVersionWithContext({
      fileExists: (pkgPath) =>
        Bun.file(path.join(sandboxDir, pkgPath)).exists(),
      getStagedFiles: () => Promise.resolve([]),
      readPackageJson: async (pkgPath) =>
        JSON.parse(
          await readFile(path.join(sandboxDir, pkgPath), "utf-8")
        ) as PackageJson,
      stageFile: (filePath) => {
        stagedByScript.add(filePath);
        return Promise.resolve();
      },
      writePackageJson: async (pkgPath, pkg) => {
        await writeFile(
          path.join(sandboxDir, pkgPath),
          `${JSON.stringify(pkg, null, 2)}\n`
        );
      },
    });

    expect(await readVersion(path.join(sandboxDir, "package.json"))).toBe(
      "1.0.1"
    );
    expect(stagedByScript.size).toBe(0);
  });
});

interface SpawnResult {
  exited: Promise<number>;
  stderr: Blob;
  stdout: Blob;
}

type SpawnFn = (args: string[], options?: unknown) => SpawnResult;

const createSpawnResult = (
  stdout = "",
  stderr = "",
  exitCode = 0
): SpawnResult => ({
  exited: Promise.resolve(exitCode),
  stderr: new Blob([stderr]),
  stdout: new Blob([stdout]),
});

const setSpawnMock = (spawnFn: SpawnFn): void => {
  Bun.spawn = spawnFn as unknown as typeof Bun.spawn;
};

describe("runBumpVersions", () => {
  let originalSpawn: typeof Bun.spawn;
  let sandboxDir = "";

  beforeEach(async () => {
    originalSpawn = Bun.spawn;
    sandboxDir = await mkdtemp(path.join(tmpdir(), "asm-run-bump-versions-"));
    await writePackageJson(path.join(sandboxDir, "package.json"), {
      name: "root",
      version: "1.0.1",
    });
  });

  afterEach(async () => {
    Bun.spawn = originalSpawn;
    if (sandboxDir) {
      await rm(sandboxDir, { force: true, recursive: true });
    }
  });

  test("end-to-end bump versions with mocks", async () => {
    // We mock Bun.spawn to pretend git is working
    setSpawnMock((args: string[]) => {
      const command = args.join(" ");
      let stdoutStr = "";
      let exitCode = 0;

      if (command === "git rev-parse --show-toplevel") {
        stdoutStr = `${sandboxDir}\n`;
      } else if (command === "git diff --cached --name-only") {
        stdoutStr = "docker/docker-compose.dev.yml\n";
      } else if (command.startsWith("git add ")) {
        exitCode = 0;
      } else {
        exitCode = 1;
      }

      return createSpawnResult(stdoutStr, "", exitCode);
    });

    await runBumpVersions();

    expect(await readVersion(path.join(sandboxDir, "package.json"))).toBe(
      "1.0.2"
    );
  });

  test("throws if getGitRepoRoot fails", async () => {
    setSpawnMock(() =>
      createSpawnResult("", "fatal: not a git repository", 128)
    );

    await expect(runBumpVersions()).rejects.toThrow(
      "Failed to resolve repository root"
    );
  });

  test("throws if getGitRepoRoot returns empty", async () => {
    setSpawnMock(() => createSpawnResult("\n", "", 0));

    await expect(runBumpVersions()).rejects.toThrow(
      "Failed to resolve repository root path"
    );
  });

  test("throws if getStagedFiles fails", async () => {
    setSpawnMock((args: string[]) => {
      if (args[0] === "git" && args[1] === "rev-parse") {
        return createSpawnResult(`${sandboxDir}\n`, "", 0);
      }
      return createSpawnResult("", "error", 1);
    });

    await expect(runBumpVersions()).rejects.toThrow(
      "Failed to read staged files"
    );
  });

  test("throws if stageFile fails", async () => {
    setSpawnMock((args: string[]) => {
      if (args[0] === "git" && args[1] === "rev-parse") {
        return createSpawnResult(`${sandboxDir}\n`, "", 0);
      }
      if (args[0] === "git" && args[1] === "diff") {
        return createSpawnResult("docker/docker-compose.dev.yml\n", "", 0);
      }
      if (args[0] === "git" && args[1] === "add") {
        return createSpawnResult("", "failed to add", 1);
      }
      return createSpawnResult("", "", 0);
    });

    await expect(runBumpVersions()).rejects.toThrow("Failed to stage");
  });
});

describe("bumpVersion error cases", () => {
  test("throws if version is missing", async () => {
    await expect(
      runBumpVersionWithContext({
        fileExists: () => Promise.resolve(true),
        getStagedFiles: () =>
          Promise.resolve(["docker/docker-compose.dev.yml"]),
        readPackageJson: () =>
          Promise.resolve({ name: "root" } as unknown as PackageJson),
        stageFile: async () => {
          // no-op
        },
        writePackageJson: async () => {
          // no-op
        },
      })
    ).rejects.toThrow("Missing version in package.json");
  });
});
