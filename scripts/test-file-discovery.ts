import { readdir } from "node:fs/promises";
import path from "node:path";

export type TestScope = "all" | "integration" | "unit";

const IGNORE_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const TEST_FILE_PATTERN = /(?:\.test|\.spec|_test_|_spec_)\.(?:[cm]?[jt]sx?)$/;
const INTEGRATION_TEST_PATTERN =
  /\.integration\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function isTestFile(fileName: string): boolean {
  return TEST_FILE_PATTERN.test(fileName);
}

function isIntegrationTestFile(repoRelativePath: string): boolean {
  return INTEGRATION_TEST_PATTERN.test(repoRelativePath);
}

async function collectTestFilesRecursive(
  directory: string,
  rootDir: string
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  const directoryEntries = entries.filter(
    (entry) => entry.isDirectory() && !IGNORE_DIRS.has(entry.name)
  );
  const nestedFiles = await Promise.all(
    directoryEntries.map((entry) =>
      collectTestFilesRecursive(path.join(directory, entry.name), rootDir)
    )
  );
  files.push(...nestedFiles.flat());

  for (const entry of entries) {
    if (!(entry.isFile() && isTestFile(entry.name))) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    const repoRelativePath = toPosixPath(path.relative(rootDir, absolutePath));
    files.push(repoRelativePath);
  }

  return files;
}

function sortFiles(paths: string[]): string[] {
  return [...paths].toSorted((a, b) => a.localeCompare(b));
}

function selectFilesForScope(files: string[], scope: TestScope): string[] {
  // Contract: collectTestFiles returns alphabetically sorted file paths.
  const integrationFiles = files.filter(isIntegrationTestFile);

  const unitFiles = files.filter(
    (filePath) => !isIntegrationTestFile(filePath)
  );

  if (scope === "integration") {
    return sortFiles(integrationFiles);
  }

  if (scope === "unit") {
    return sortFiles(unitFiles);
  }

  return sortFiles(files);
}

export async function collectTestFiles(
  scope: TestScope,
  rootDir = process.cwd()
): Promise<string[]> {
  const collected = await collectTestFilesRecursive(rootDir, rootDir);
  const allFiles = collected.toSorted((a, b) => a.localeCompare(b));

  return selectFilesForScope(allFiles, scope);
}
