import { isDeepStrictEqual } from "node:util";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withoutVersion(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError("Expected package metadata");
  }
  const result = { ...value };
  delete result.version;
  return result;
}

function normalizedMetadata(filePath: string, contents: string) {
  const parsed: unknown = Bun.JSONC.parse(contents);
  if (filePath === "package.json") {
    return withoutVersion(parsed);
  }
  if (
    !(
      filePath === "bun.lock" &&
      isRecord(parsed) &&
      isRecord(parsed.workspaces)
    )
  ) {
    throw new TypeError("Expected a Bun lockfile with workspaces");
  }
  return {
    ...parsed,
    workspaces: Object.fromEntries(
      Object.entries(parsed.workspaces).map(([directory, workspace]) => [
        directory,
        withoutVersion(workspace),
      ])
    ),
  };
}

export function isVersionOnlyMetadataChange(
  filePath: string,
  before: string,
  after: string
): boolean {
  try {
    return isDeepStrictEqual(
      normalizedMetadata(filePath, before),
      normalizedMetadata(filePath, after)
    );
  } catch {
    // Unknown metadata formats retain the conservative full-unit-suite fallback.
    return false;
  }
}

async function gitOutput(arguments_: string[]): Promise<string | undefined> {
  const child = Bun.spawn(["git", ...arguments_], {
    stderr: "ignore",
    stdout: "pipe",
  });
  const [exitCode, output] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ]);
  return exitCode === 0 ? output : undefined;
}

export async function versionOnlyPushedMetadata(
  changedFiles: string[]
): Promise<string[]> {
  const candidates = changedFiles.filter(
    (filePath) => filePath === "package.json" || filePath === "bun.lock"
  );
  if (candidates.length === 0) {
    return [];
  }
  const base = (await gitOutput(["merge-base", "HEAD", "@{upstream}"]))?.trim();
  if (!base) {
    return [];
  }
  const results = await Promise.all(
    candidates.map(async (filePath) => {
      const [before, after, unchangedWorkingTree] = await Promise.all([
        gitOutput(["show", `${base}:${filePath}`]),
        gitOutput(["show", `HEAD:${filePath}`]),
        gitOutput(["diff", "--quiet", "HEAD", "--", filePath]),
      ]);
      // Manual checks with uncommitted metadata retain the global fallback.
      return unchangedWorkingTree !== undefined &&
        before !== undefined &&
        after !== undefined &&
        isVersionOnlyMetadataChange(filePath, before, after)
        ? filePath
        : undefined;
    })
  );
  return results.filter((filePath) => filePath !== undefined);
}
