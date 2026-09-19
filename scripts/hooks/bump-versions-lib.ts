import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const packagesRegex = /^packages\/(?<package>[^/]+)/;
const appsRegex = /^apps\/(?<package>[^/]+)/;

export interface PackageJson {
  version: string;
  [key: string]: unknown;
}

export interface AppJson {
  expo?: {
    version?: string;
    [key: string]: unknown;
  };
  version?: string;
  [key: string]: unknown;
}

export interface BumpContext {
  fileExists: (pkgPath: string) => Promise<boolean>;
  getStagedFiles: () => Promise<string[]>;
  readPackageJson: (pkgPath: string) => Promise<PackageJson>;
  readAppJson?: (appPath: string) => Promise<AppJson>;
  stageFile: (filePath: string) => Promise<void>;
  writePackageJson: (pkgPath: string, pkg: PackageJson) => Promise<void>;
  writeAppJson?: (appPath: string, app: AppJson) => Promise<void>;
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

export function getVersionTargets(changedPackages: Set<string>): string[] {
  const targets = new Set<string>(["package.json"]);

  for (const pkg of changedPackages) {
    targets.add(path.join("packages", pkg, "package.json"));
    targets.add(path.join("apps", pkg, "package.json"));
  }

  return [...targets];
}

export function getAppJsonTargets(changedPackages: Set<string>): string[] {
  const targets = new Set<string>();

  for (const pkg of changedPackages) {
    targets.add(path.join("apps", pkg, "app.json"));
  }

  return [...targets];
}

function getAppJsonVersion(app: AppJson): string | undefined {
  return (
    app.expo?.version ??
    (typeof app.version === "string" ? app.version : undefined)
  );
}

const MOBILE_PACKAGE_PATH = path.join("apps", "mobile", "package.json");
const MOBILE_APP_JSON_PATH = path.join("apps", "mobile", "app.json");

async function readPackageTargets(
  targets: string[],
  context: BumpContext
): Promise<Map<string, PackageJson>> {
  const packages = new Map<string, PackageJson>();

  for (const target of targets) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await context.fileExists(target))) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const pkg = await context.readPackageJson(target);
    if (typeof pkg.version !== "string") {
      throw new TypeError(`Missing version in ${target}`);
    }
    packages.set(target, pkg);
  }

  return packages;
}

async function readAppTargets(
  targets: string[],
  context: BumpContext
): Promise<Map<string, AppJson>> {
  const apps = new Map<string, AppJson>();

  for (const target of targets) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await context.fileExists(target))) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const app = context.readAppJson
      ? await context.readAppJson(target)
      : ((await context.readPackageJson(target)) as unknown as AppJson);
    if (typeof getAppJsonVersion(app) !== "string") {
      throw new TypeError(`Missing version in ${target}`);
    }
    apps.set(target, app);
  }

  return apps;
}

async function bumpVersions(
  changedPackages: Set<string>,
  context: BumpContext
): Promise<void> {
  const packageTargets = getVersionTargets(changedPackages);
  const appTargets = getAppJsonTargets(changedPackages);

  // Read and validate every manifest before writing or staging anything, so a
  // malformed target leaves the repository and index untouched.
  const packages = await readPackageTargets(packageTargets, context);
  const apps = await readAppTargets(appTargets, context);

  // Drive both mobile manifests from one canonical version so a pre-existing
  // package.json/app.json mismatch is repaired instead of carried forward.
  const mobileCanonical =
    packages.get(MOBILE_PACKAGE_PATH)?.version ??
    (apps.has(MOBILE_APP_JSON_PATH)
      ? getAppJsonVersion(apps.get(MOBILE_APP_JSON_PATH) as AppJson)
      : undefined);
  const mobileNextVersion =
    typeof mobileCanonical === "string"
      ? bumpPatchVersion(mobileCanonical)
      : undefined;

  const packageWrites = [...packages.entries()].map(([pkgPath, pkg]) => ({
    pkg: {
      ...pkg,
      version:
        pkgPath === MOBILE_PACKAGE_PATH && mobileNextVersion
          ? mobileNextVersion
          : bumpPatchVersion(pkg.version),
    },
    pkgPath,
  }));

  const appWrites = [...apps.entries()].map(([appPath, app]) => {
    const nextVersion =
      appPath === MOBILE_APP_JSON_PATH && mobileNextVersion
        ? mobileNextVersion
        : bumpPatchVersion(getAppJsonVersion(app) as string);

    if (app.expo && typeof app.expo.version === "string") {
      return {
        app: { ...app, expo: { ...app.expo, version: nextVersion } },
        appPath,
      };
    }
    if (typeof app.version === "string") {
      return { app: { ...app, version: nextVersion }, appPath };
    }
    return { app, appPath };
  });

  // Only now touch disk and the index.
  for (const { pkg, pkgPath } of packageWrites) {
    // eslint-disable-next-line no-await-in-loop
    await context.writePackageJson(pkgPath, pkg);
    // eslint-disable-next-line no-await-in-loop
    await context.stageFile(pkgPath);
  }

  for (const { app, appPath } of appWrites) {
    if (context.writeAppJson) {
      // eslint-disable-next-line no-await-in-loop
      await context.writeAppJson(appPath, app);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await context.writePackageJson(appPath, app as unknown as PackageJson);
    }
    // eslint-disable-next-line no-await-in-loop
    await context.stageFile(appPath);
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
    readAppJson: async (appPath) => {
      const content = await readFile(path.join(repoRoot, appPath), "utf-8");
      return JSON.parse(content) as AppJson;
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
    writeAppJson: async (appPath, app) => {
      await writeFile(
        path.join(repoRoot, appPath),
        `${JSON.stringify(app, null, 2)}\n`
      );
    },
  };
}

export async function runBumpVersions() {
  const repoRoot = await getGitRepoRoot();
  const context = createRuntimeContext(repoRoot);
  await runBumpVersionWithContext(context);
}
