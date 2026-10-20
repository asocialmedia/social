import { loadRootEnv } from "@asm/next";

export async function registerNodeInstrumentation() {
  loadRootEnv();
  if (process.env.NODE_ENV === "development") {
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) {
        process.exit(0);
      }
      shuttingDown = true;
      // Give Next.js time to close listeners before terminating lingering watchers.
      const timer = setTimeout(() => {
        process.exit(0);
      }, 1500);
      timer.unref();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
  const { initWebTelemetry } = await import("./src/lib/otel");
  await initWebTelemetry();
}
