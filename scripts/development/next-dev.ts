import path from "node:path";
import { fileURLToPath } from "node:url";

export function nextDevCommand(args: string[] = []): string[] {
  let runtime = "node";
  // Keep Windows development independent of globally installed Node prereleases.
  if (process.platform === "win32") {
    const runtimePackage =
      process.arch === "arm64" ? "node-win-arm64" : "node-win-x64";
    const runtimeDirectory = path.dirname(
      fileURLToPath(import.meta.resolve(`${runtimePackage}/package.json`))
    );
    runtime = path.join(runtimeDirectory, "bin", "node.exe");
  }
  return [
    runtime,
    fileURLToPath(import.meta.resolve("next/dist/bin/next")),
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
