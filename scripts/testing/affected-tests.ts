import { readdir } from "node:fs/promises";
import path from "node:path";

export interface TestWorkspace {
  dependencies: string[];
  directory: string;
  name: string;
}

interface WorkspaceManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name: string;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export async function readTestWorkspaces(
  rootDir = process.cwd()
): Promise<TestWorkspace[]> {
  const groups = await Promise.all(
    ["apps", "packages"].map(async (group) => {
      const entries = await readdir(path.join(rootDir, group), {
        withFileTypes: true,
      });
      return await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            const directory = `${group}/${entry.name}`;
            const file = Bun.file(
              path.join(rootDir, directory, "package.json")
            );
            if (!(await file.exists())) {
              return undefined;
            }
            const manifest: WorkspaceManifest = await file.json();
            return {
              dependencies: Object.keys({
                ...manifest.dependencies,
                ...manifest.devDependencies,
                ...manifest.optionalDependencies,
                ...manifest.peerDependencies,
              }),
              directory,
              name: manifest.name,
            };
          })
      );
    })
  );
  return groups.flat().filter((workspace) => workspace !== undefined);
}

function isDocumentation(filePath: string): boolean {
  return /\.(?:md|mdx|txt)$/i.test(filePath);
}

export function selectAffectedTests(
  changedFiles: string[],
  testFiles: string[],
  workspaces: TestWorkspace[]
): string[] {
  const changes = changedFiles
    .map((filePath) => filePath.replaceAll("\\", "/").replace(/^\.\//, ""))
    .filter((filePath) => !isDocumentation(filePath));
  if (changes.length === 0) {
    return [];
  }

  const affected = new Set<string>();
  let toolingChanged = false;
  for (const filePath of changes) {
    const workspace = workspaces.find((candidate) =>
      filePath.startsWith(`${candidate.directory}/`)
    );
    if (workspace) {
      affected.add(workspace.name);
    } else if (
      filePath.startsWith(".github/") ||
      filePath.startsWith("scripts/ci/")
    ) {
      toolingChanged = true;
    } else {
      // Root configuration, test tooling, patches, and unknown/deleted workspaces can affect every test.
      return testFiles;
    }
  }

  // Include transitive consumers of shared packages, including development dependencies.
  let previousSize = -1;
  while (previousSize !== affected.size) {
    previousSize = affected.size;
    for (const workspace of workspaces) {
      if (
        workspace.dependencies.some((dependency) => affected.has(dependency))
      ) {
        affected.add(workspace.name);
      }
    }
  }

  const directories = workspaces
    .filter((workspace) => affected.has(workspace.name))
    .map((workspace) => `${workspace.directory}/`);
  return testFiles.filter(
    (filePath) =>
      directories.some((directory) => filePath.startsWith(directory)) ||
      // Tooling tests also inspect source files and build entrypoints across workspaces.
      filePath.startsWith("scripts/") ||
      filePath.startsWith(".github/") ||
      (toolingChanged && filePath.startsWith("apps/mobile/scripts/"))
  );
}
