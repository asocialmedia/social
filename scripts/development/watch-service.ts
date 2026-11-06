import { realpath } from "node:fs/promises";
import path from "node:path";

export function workspaceWatchOptions(options: {
  entrypoint: string;
  workingDirectory: string;
  watchRoot: string;
  flags?: string[];
}) {
  return {
    cmd: [
      process.execPath,
      ...(options.flags ?? []),
      "--preload",
      path.join(import.meta.dir, "watch-service-preload.ts"),
      "--watch",
      path.resolve(options.workingDirectory, options.entrypoint),
    ],
    cwd: options.watchRoot,
    env: { ...process.env, ASM_DEV_SERVICE_CWD: options.workingDirectory },
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const entrypoint = args.pop();
  if (!entrypoint) throw new Error("A service entrypoint is required");
  const child = Bun.spawn({
    ...workspaceWatchOptions({
      entrypoint,
      flags: args,
      workingDirectory: await realpath(process.cwd()),
      watchRoot: await realpath(path.resolve(import.meta.dir, "../..")),
    }),
    stdout: "inherit",
    stderr: "inherit",
  });
  process.once("SIGTERM", () => child.kill("SIGTERM"));
  process.once("SIGINT", () => child.kill("SIGINT"));
  process.exit(await child.exited);
}
