import { loadRootEnv } from "./env";

// Dev entrypoint that runs the HTTP server and the background worker as two
// watch-enabled subprocesses under one process tree, so `turbo dev` starts
// both. The worker is what consumes the view/share streams, media cleanup
// jobs, and maintenance schedules; without it the app runs but the event
// pipeline never processes.
if (import.meta.main) {
  loadRootEnv();

  const serverProc = Bun.spawn(["bun", "--watch", "src/server.ts"], {
    cwd: process.cwd(),
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  });

  const workerProc = Bun.spawn(["bun", "--watch", "src/worker.ts"], {
    cwd: process.cwd(),
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  });

  const shutdown = async (signal: string) => {
    console.log(`[dev] ${signal}: stopping server and worker`);
    serverProc.kill();
    workerProc.kill();
    await Promise.all([serverProc.exited, workerProc.exited]);
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT").catch(() => process.exit(1));
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch(() => process.exit(1));
  });

  await Promise.all([serverProc.exited, workerProc.exited]);
}
