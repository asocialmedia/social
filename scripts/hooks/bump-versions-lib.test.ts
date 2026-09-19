import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  bumpPatchVersion,
  determineChangedPackages,
  getAppJsonTargets,
  getVersionTargets,
  hasRootChanges,
  runBumpVersions,
  runBumpVersionWithContext,
  updateLockfileWorkspaceVersions,
} from "./bump-versions-lib";
import type { AppJson, PackageJson } from "./bump-versions-lib";

async function writePackageJson(filePath: string, pkg: PackageJson) {
  await writeFile(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function writeAppJson(filePath: string, app: AppJson) {
  await writeFile(filePath, `${JSON.stringify(app, null, 2)}\n`);
}

async function readVersion(filePath: string) {
  const content = await readFile(filePath, "utf-8");
  return (JSON.parse(content) as PackageJson).version;
}

async function readAppVersion(filePath: string) {
  const content = await readFile(filePath, "utf-8");
  const app = JSON.parse(content) as AppJson;
  return app.expo?.version ?? app.version;
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

describe("getVersionTargets", () => {
  test("generates version targets including root and changed workspaces", () => {
    const targets = getVersionTargets(new Set(["mobile", "ui"]));
    expect(targets.toSorted()).toEqual([
      "apps/mobile/package.json",
      "apps/ui/package.json",
      "package.json",
      "packages/mobile/package.json",
      "packages/ui/package.json",
    ]);
  });
});

describe("getAppJsonTargets", () => {
  test("generates app.json paths for changed apps", () => {
    const targets = getAppJsonTargets(new Set(["mobile", "ui"]));
    expect(targets.toSorted()).toEqual([
      "apps/mobile/app.json",
      "apps/ui/app.json",
    ]);
  });

  test("returns empty array when no packages changed", () => {
    expect(getAppJsonTargets(new Set())).toEqual([]);
  });
});

describe("updateLockfileWorkspaceVersions", () => {
  const lockfile = [
    "{",
    '  "lockfileVersion": 1,',
    '  "workspaces": {',
    '    "apps/web": {',
    '      "name": "@asm/web",',
    '      "version": "1.4.73",',
    '      "dependencies": {',
    '        "react": "^19.2.8",',
    "      },",
    "    },",
    '    "apps/mobile": {',
    '      "name": "@asocialmedia/mobile",',
    '      "version": "0.0.3",',
    "    },",
    "  },",
    "}",
    "",
  ].join("\n");

  test("updates only the targeted workspace versions", () => {
    const updated = updateLockfileWorkspaceVersions(
      lockfile,
      new Map([
        ["apps/web", "1.4.74"],
        ["apps/mobile", "0.0.4"],
      ])
    );

    expect(updated).toContain('"version": "1.4.74"');
    expect(updated).toContain('"version": "0.0.4"');
    // Dependency ranges are untouched.
    expect(updated).toContain('"react": "^19.2.8"');
    expect(updated).not.toContain('"version": "1.4.73"');
    expect(updated).not.toContain('"version": "0.0.3"');
  });

  test("ignores workspace paths that are not present in the lock", () => {
    expect(
      updateLockfileWorkspaceVersions(
        lockfile,
        new Map([["apps/missing", "9.9.9"]])
      )
    ).toBe(lockfile);
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

  test("bumps app.json alongside package.json when mobile app has changes", async () => {
    await mkdir(path.join(sandboxDir, "apps", "mobile"), { recursive: true });
    await writePackageJson(
      path.join(sandboxDir, "apps", "mobile", "package.json"),
      {
        name: "mobile",
        version: "0.0.1",
      }
    );
    await writeAppJson(path.join(sandboxDir, "apps", "mobile", "app.json"), {
      expo: {
        name: "asocialmedia",
        version: "0.0.1",
      },
    });

    stagedFiles = new Set(["apps/mobile/src/index.tsx"]);

    await runBumpVersionWithContext({
      fileExists: (pkgPath) =>
        Bun.file(path.join(sandboxDir, pkgPath)).exists(),
      getStagedFiles: () => Promise.resolve([...stagedFiles]),
      readPackageJson: async (pkgPath) =>
        JSON.parse(
          await readFile(path.join(sandboxDir, pkgPath), "utf-8")
        ) as PackageJson,
      readAppJson: async (appPath) =>
        JSON.parse(
          await readFile(path.join(sandboxDir, appPath), "utf-8")
        ) as AppJson,
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
      writeAppJson: async (appPath, app) => {
        await writeFile(
          path.join(sandboxDir, appPath),
          `${JSON.stringify(app, null, 2)}\n`
        );
      },
    });

    expect(await readVersion(path.join(sandboxDir, "package.json"))).toBe(
      "1.0.2"
    );
    expect(
      await readVersion(path.join(sandboxDir, "apps", "mobile", "package.json"))
    ).toBe("0.0.2");
    expect(
      await readAppVersion(path.join(sandboxDir, "apps", "mobile", "app.json"))
    ).toBe("0.0.2");
    expect(
      await readVersion(path.join(sandboxDir, "apps", "docs", "package.json"))
    ).toBe("0.0.1");

    expect([...stagedByScript].toSorted()).toEqual([
      "apps/mobile/app.json",
      "apps/mobile/package.json",
      "package.json",
    ]);
  });

  test("formats the rewritten manifests and re-stages them", async () => {
    const formatted: string[][] = [];
    const stagedAfterFormat: string[] = [];
    const written: string[] = [];
    let formatting = false;

    await runBumpVersionWithContext({
      // Only the paths this scenario actually has on disk; a blanket `true`
      // would invent `packages/mobile/package.json`.
      fileExists: (pkgPath) =>
        Promise.resolve(
          [
            "package.json",
            "apps/mobile/package.json",
            "apps/mobile/app.json",
          ].includes(pkgPath)
        ),
      formatFiles: (filePaths) => {
        formatting = true;
        formatted.push([...filePaths]);
        return Promise.resolve();
      },
      getStagedFiles: () => Promise.resolve(["apps/mobile/app.json"]),
      readPackageJson: (pkgPath) =>
        Promise.resolve({
          version: pkgPath === "package.json" ? "1.0.1" : "0.0.1",
        }),
      readAppJson: () => Promise.resolve({ expo: { version: "0.0.1" } }),
      stageFile: (filePath) => {
        if (formatting) {
          stagedAfterFormat.push(filePath);
        } else {
          written.push(filePath);
        }
        return Promise.resolve();
      },
      writePackageJson: () => Promise.resolve(),
      writeAppJson: () => Promise.resolve(),
    });

    // Formatter runs once, over every manifest the bump rewrote...
    expect(formatted).toHaveLength(1);
    expect([...(formatted[0] ?? [])].toSorted()).toEqual([
      "apps/mobile/app.json",
      "apps/mobile/package.json",
      "package.json",
    ]);
    // ...and every one of them is staged again afterwards, so the committed
    // bytes are the formatter's output rather than the raw JSON.stringify.
    expect([...stagedAfterFormat].toSorted()).toEqual([
      "apps/mobile/app.json",
      "apps/mobile/package.json",
      "package.json",
    ]);
  });

  test("keeps bun.lock workspace versions in sync with the bumped manifests", async () => {
    await writeFile(
      path.join(sandboxDir, "bun.lock"),
      [
        "{",
        '  "workspaces": {',
        '    "apps/web": {',
        '      "name": "web",',
        '      "version": "1.0.1",',
        "    },",
        "  },",
        "}",
        "",
      ].join("\n")
    );
    stagedFiles = new Set(["apps/web/src/app/page.tsx"]);

    await runBumpVersionWithContext({
      fileExists: (pkgPath) =>
        Bun.file(path.join(sandboxDir, pkgPath)).exists(),
      getStagedFiles: () => Promise.resolve([...stagedFiles]),
      readLockfile: (lockPath) =>
        readFile(path.join(sandboxDir, lockPath), "utf-8"),
      readPackageJson: async (pkgPath) =>
        JSON.parse(
          await readFile(path.join(sandboxDir, pkgPath), "utf-8")
        ) as PackageJson,
      stageFile: (filePath) => {
        stagedByScript.add(filePath);
        return Promise.resolve();
      },
      writeLockfile: async (lockPath, content) => {
        await writeFile(path.join(sandboxDir, lockPath), content);
      },
      writePackageJson: async (pkgPath, pkg) => {
        await writeFile(
          path.join(sandboxDir, pkgPath),
          `${JSON.stringify(pkg, null, 2)}\n`
        );
      },
    });

    const lock = await readFile(path.join(sandboxDir, "bun.lock"), "utf-8");
    expect(lock).toContain('"version": "1.0.2"');
    expect(stagedByScript.has("bun.lock")).toBe(true);
  });

  test("does not bump mobile app.json when only other apps are staged", async () => {
    await mkdir(path.join(sandboxDir, "apps", "mobile"), { recursive: true });
    await writePackageJson(
      path.join(sandboxDir, "apps", "mobile", "package.json"),
      {
        name: "mobile",
        version: "0.0.1",
      }
    );
    await writeAppJson(path.join(sandboxDir, "apps", "mobile", "app.json"), {
      expo: {
        name: "asocialmedia",
        version: "0.0.1",
      },
    });

    stagedFiles = new Set(["apps/web/src/app/page.tsx"]);

    await runBumpVersionWithContext({
      fileExists: (pkgPath) =>
        Bun.file(path.join(sandboxDir, pkgPath)).exists(),
      getStagedFiles: () => Promise.resolve([...stagedFiles]),
      readPackageJson: async (pkgPath) =>
        JSON.parse(
          await readFile(path.join(sandboxDir, pkgPath), "utf-8")
        ) as PackageJson,
      readAppJson: async (appPath) =>
        JSON.parse(
          await readFile(path.join(sandboxDir, appPath), "utf-8")
        ) as AppJson,
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
      writeAppJson: async (appPath, app) => {
        await writeFile(
          path.join(sandboxDir, appPath),
          `${JSON.stringify(app, null, 2)}\n`
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
      await readVersion(path.join(sandboxDir, "apps", "mobile", "package.json"))
    ).toBe("0.0.1");
    expect(
      await readAppVersion(path.join(sandboxDir, "apps", "mobile", "app.json"))
    ).toBe("0.0.1");

    expect(stagedByScript.has("apps/mobile/app.json")).toBe(false);
    expect(stagedByScript.has("apps/mobile/package.json")).toBe(false);
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

  test("throws if version is missing in app.json", async () => {
    await expect(
      runBumpVersionWithContext({
        fileExists: () => Promise.resolve(true),
        getStagedFiles: () => Promise.resolve(["apps/mobile/src/index.tsx"]),
        readPackageJson: () =>
          Promise.resolve({ name: "mobile", version: "0.0.1" }),
        readAppJson: () =>
          Promise.resolve({
            expo: {
              name: "mobile",
            },
          }),
        stageFile: async () => {
          // no-op
        },
        writePackageJson: async () => {
          // no-op
        },
        writeAppJson: async () => {
          // no-op
        },
      })
    ).rejects.toThrow("Missing version in apps/mobile/app.json");
  });
});
