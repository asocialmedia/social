import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const packagesRegex = /^packages\/(?<package>[^/]+)/;
const appsRegex = /^apps\/(?<package>[^/]+)/;

export interface PackageJson {
  version: string;
  [key: string]: unknown;
}

export interface BumpContext {
  fileExists: (pkgPath: string) => Promise<boolean>;
  getStagedFiles: () => Promise<string[]>;
  readPackageJson: (pkgPath: string) => Promise<PackageJson>;
  stageFile: (filePath: string) => Promise<void>;
  writePackageJson: (pkgPath: string, pkg: PackageJson) => Promise<void>;
}

interface GitCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export function bumpPatchVersion(version: string): string {
  const parts = version.split(".").map((part) => Math.trunc(Number(part)));

  if (
    parts.length !== 3 ||
    parts.some((part) => Number.isNaN(part) || part < 0)
  ) {
    throw new Error(`Invalid version format: ${version}`);
  }

  let [major, middle, patch] = parts;
  patch += 1;

  if (patch > 99) {
    patch = 0;
    middle += 1;
    if (middle > 99) {
      middle = 0;
      major += 1;
    }
  }

  return `${major}.${middle}.${patch}`;
}

export function determineChangedPackages(stagedFiles: string[]): Set<string> {
  const changedPackages = new Set<string>();

  for (const file of stagedFiles) {
    if (file.startsWith("packages/")) {
      const match = file.match(packagesRegex);
      if (match?.groups?.package) {
        changedPackages.add(match.groups.package);
      }
      continue;
    }

    if (file.startsWith("apps/")) {
      const match = file.match(appsRegex);
      if (match?.groups?.package) {
        changedPackages.add(match.groups.package);
      }
    }
  }

  return changedPackages;
}

export function hasRootChanges(stagedFiles: string[]): boolean {
  return stagedFiles.some(
    (file) => !(file.startsWith("packages/") || file.startsWith("apps/"))
  );
}

function getVersionTargets(changedPackages: Set<string>): string[] {
  const targets = new Set<string>(["package.json"]);

  for (const pkg of changedPackages) {
    targets.add(path.join("packages", pkg, "package.json"));
    targets.add(path.join("apps", pkg, "package.json"));
  }

  return [...targets];
}

async function bumpVersion(
  pkgPath: string,
  context: BumpContext
): Promise<boolean> {
  if (!(await context.fileExists(pkgPath))) {
    return false;
  }

  const pkg = await context.readPackageJson(pkgPath);
  if (typeof pkg.version !== "string") {
    throw new TypeError(`Missing version in ${pkgPath}`);
  }

  pkg.version = bumpPatchVersion(pkg.version);
  await context.writePackageJson(pkgPath, pkg);
  await context.stageFile(pkgPath);

  return true;
}

async function bumpVersions(
  changedPackages: Set<string>,
  context: BumpContext
): Promise<void> {
  const targets = getVersionTargets(changedPackages);

  for (const target of targets) {
    // eslint-disable-next-line no-await-in-loop
    await bumpVersion(target, context);
  }
}

export async function runBumpVersionWithContext(context: BumpContext) {
  const stagedFiles = await context.getStagedFiles();
  const changedPackages = determineChangedPackages(stagedFiles);
  const rootChanged = hasRootChanges(stagedFiles);

  if (changedPackages.size > 0 || rootChanged) {
    await bumpVersions(changedPackages, context);
  }
}

async function runGitCommand(
  repoRoot: string,
  args: string[]
): Promise<GitCommandResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: repoRoot,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stderr, stdout };
}

async function getGitRepoRoot(): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Failed to resolve repository root: ${stderr.trim()}`);
  }

  const repoRoot = stdout.trim();
  if (!repoRoot) {
    throw new Error("Failed to resolve repository root path");
  }

  return repoRoot;
}

function createRuntimeContext(repoRoot: string): BumpContext {
  return {
    fileExists: async (pkgPath) => {
      try {
        await access(path.join(repoRoot, pkgPath), constants.F_OK);
        return true;
      } catch {
        return false;
      }
    },
    getStagedFiles: async () => {
      const result = await runGitCommand(repoRoot, [
        "diff",
        "--cached",
        "--name-only",
      ]);

      if (result.exitCode !== 0) {
        throw new Error(`Failed to read staged files: ${result.stderr.trim()}`);
      }

      return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    },
    readPackageJson: async (pkgPath) => {
      const content = await readFile(path.join(repoRoot, pkgPath), "utf-8");
      return JSON.parse(content) as PackageJson;
    },
    stageFile: async (filePath) => {
      const result = await runGitCommand(repoRoot, ["add", filePath]);
      if (result.exitCode !== 0) {
        throw new Error(
          `Failed to stage ${filePath}: ${result.stderr.trim() || result.stdout.trim()}`
        );
      }
    },
    writePackageJson: async (pkgPath, pkg) => {
      await writeFile(
        path.join(repoRoot, pkgPath),
        `${JSON.stringify(pkg, null, 2)}\n`
      );
    },
  };
}

export async function runBumpVersions() {
  const repoRoot = await getGitRepoRoot();
  const context = createRuntimeContext(repoRoot);
  await runBumpVersionWithContext(context);
}
