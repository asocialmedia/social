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
  void (async () => {
    const { initWebTelemetry } = await import("./src/lib/otel");
    initWebTelemetry();
  })();
}
