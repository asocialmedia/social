import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";

import { workspaceWatchOptions } from "./watch-service";

test("restarts for shared workspace edits while retaining the service working directory", async () => {
  const watchRoot = await realpath(path.resolve(import.meta.dir, "../.."));
  const cacheDirectory = path.join(watchRoot, ".cache");
  await mkdir(cacheDirectory, { recursive: true });
  const root = await realpath(
    await mkdtemp(path.join(cacheDirectory, "asm-workspace-watch-"))
  );
  const appDirectory = path.join(root, "apps", "example");
  const shared = path.join(root, "shared.ts");
  await Bun.write(shared, "export const version = 1;");
  // A service may handle SIGTERM without exiting; cleanup must still be bounded.
  await Bun.write(
    path.join(appDirectory, "main.ts"),
    'import { version } from "../../shared.ts"; process.on("SIGTERM", () => {}); process.stdout.write(JSON.stringify({ version, cwd: process.cwd(), main: import.meta.main }) + "\\n"); setInterval(() => {}, 1000);'
  );
  const watchOptions = workspaceWatchOptions({
    entrypoint: "main.ts",
    flags: ["--no-clear-screen"],
    workingDirectory: appDirectory,
    watchRoot,
  });
  const child = Bun.spawn({
    ...watchOptions,
    detached: process.platform !== "win32",
    env: { ...watchOptions.env, FORCE_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  const errors = new Response(child.stderr).text();
  let cleanup: Promise<void> | undefined;
  const stopWatcher = () => {
    cleanup ??= (async () => {
      if (process.platform === "win32") {
        const termination = Bun.spawn(
          ["taskkill", "/PID", String(child.pid), "/T", "/F"],
          { stdout: "ignore", stderr: "ignore" }
        );
        await termination.exited;
      } else {
        // Watch mode has a supervisor and a service sharing the output pipes.
        // Terminate their isolated group so neither keeps stream reads pending.
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (
            !error ||
            typeof error !== "object" ||
            !("code" in error) ||
            error.code !== "ESRCH"
          ) {
            throw error;
          }
        }
      }
      await child.exited;
    })();
    return cleanup;
  };
  const timeout = setTimeout(() => void stopWatcher(), 5000);
  try {
    let output = "";
    let changed = false;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      output += new TextDecoder().decode(chunk.value);
      if (!changed && output.includes('"version":1')) {
        changed = true;
        await Bun.write(shared, "export const version = 2;");
      }
      if (
        output
          .split(/\r?\n/)
          .slice(0, -1)
          .some((line) => JSON.parse(line).version === 2)
      )
        break;
    }
    expect(output).toContain('"version":2');
    const runs = output
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    expect(runs).toEqual([
      { version: 1, cwd: appDirectory, main: true },
      { version: 2, cwd: appDirectory, main: true },
    ]);
  } finally {
    clearTimeout(timeout);
    await stopWatcher();
    reader.releaseLock();
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true });
        break;
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? error.code
            : null;
        if (attempt >= 9 || (code !== "EBUSY" && code !== "EPERM")) throw error;
        await Bun.sleep(100);
      }
    }
  }
  expect(await errors).not.toContain("will not be watched");
}, 10_000);
