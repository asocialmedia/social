import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function nextDevCommand(
  args: string[] = [],
  options: {
    platform?: NodeJS.Platform;
    arch?: string;
    resolveRuntime?: (specifier: string) => string;
  } = {}
): string[] {
  let runtime = "node";
  // Keep Windows development independent of globally installed Node prereleases.
  if ((options.platform ?? process.platform) === "win32") {
    const runtimePackage =
      (options.arch ?? process.arch) === "arm64"
        ? "node-win-arm64"
        : "node-win-x64";
    let runtimeDirectory: string;
    try {
      const specifier = `${runtimePackage}/package.json`;
      const resolved = options.resolveRuntime
        ? options.resolveRuntime(specifier)
        : import.meta.resolve(specifier);
      runtimeDirectory = path.dirname(fileURLToPath(resolved));
    } catch {
      throw new Error(
        `Windows development requires ${runtimePackage}@24.22.2. Run bun install with optional dependencies enabled.`
      );
    }
    runtime = path.join(runtimeDirectory, "bin", "node.exe");
  }
  return [
    runtime,
    createRequire(
      path.resolve(import.meta.dir, "../../apps/web/package.json")
    ).resolve("next/dist/bin/next"),
    "dev",
    ...args,
  ];
}

if (import.meta.main) {
  const child = Bun.spawn(nextDevCommand(process.argv.slice(2)), {
    stdout: "inherit",
    stderr: "inherit",
  });
  process.once("SIGTERM", () => child.kill("SIGTERM"));
  process.once("SIGINT", () => child.kill("SIGINT"));
  process.exit(await child.exited);
}
