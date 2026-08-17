import { loadRootEnv } from "@asm/next";

export function register() {
  loadRootEnv();
  // Telemetry is wired on the Node.js server at runtime. initWebTelemetry is
  // a no-op unless the OTLP endpoint env vars are set, so builds and unset
  // environments stay offline.
  void (async () => {
    const { initWebTelemetry } = await import("./src/lib/otel");
    initWebTelemetry();
  })();
}
