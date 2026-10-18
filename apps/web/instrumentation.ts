import { loadRootEnv } from "@asm/next";

export function register() {
  loadRootEnv();
  // Telemetry is wired on the Node.js server at runtime only. instrumentation
  // also runs inside the Edge runtime (proxy/middleware), which cannot import
  // @asm/logger (it uses node:stream / process.stderr), so guard the whole
  // Node-only module behind the runtime check. initWebTelemetry is additionally
  // a no-op unless the OTLP endpoint env vars are set.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  // Ensure dev server exits gracefully and promptly on SIGINT / SIGTERM without
  // hanging Turborepo tasks (e.g. from lingering keep-alive sockets or HMR connections).
  if (process.env.NODE_ENV === "development") {
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) {
        process.exit(0);
      }
      shuttingDown = true;
      // Allow Next.js a short window to flush and close listeners, then force exit
      // to prevent lingering HMR sockets or file watchers from hanging `turbo dev`.
      const timer = setTimeout(() => {
        process.exit(0);
      }, 1500);
      timer.unref();
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }

  void (async () => {
    const { initWebTelemetry } = await import("./src/lib/otel");
    initWebTelemetry();
  })();
}
