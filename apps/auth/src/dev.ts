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

  let stopping = false;

  const stopChildren = () => {
    serverProc.kill();
    workerProc.kill();
    return Promise.all([serverProc.exited, workerProc.exited]);
  };

  // Signal-triggered shutdown is a clean exit for `turbo dev`.
  const shutdown = async (signal: string) => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`[dev] ${signal}: stopping server and worker`);
    await stopChildren();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT").catch(() => process.exit(1));
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch(() => process.exit(1));
  });

  // Whichever child exits first stops its sibling, so `turbo dev` never hangs
  // with an orphaned watcher while the other keeps running. An unexpected
  // (non-zero) exit fails the dev process so CI notices the crash.
  const onChildExit = (name: string, proc: ReturnType<typeof Bun.spawn>) => {
    proc.exited.then((code) => {
      if (stopping) {
        return;
      }
      stopping = true;
      console.log(`[dev] ${name} exited with code ${code ?? "signal"}`);
      stopChildren().then(() => {
        process.exit(code === 0 ? 0 : 1);
      });
    });
  };
  onChildExit("server", serverProc);
  onChildExit("worker", workerProc);
}
