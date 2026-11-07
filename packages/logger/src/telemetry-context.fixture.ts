import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { context, trace } from "@opentelemetry/api";
import { isTracingSuppressed } from "@opentelemetry/core";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import { bindTelemetryExport } from "./telemetry-context";

// Isolate SDK global registration from the application's other telemetry tests.
const provider = new NodeTracerProvider();
provider.register();
const requestStore = new AsyncLocalStorage<string>();
const span = provider.getTracer("test").startSpan("request");
try {
  await context.with(trace.setSpan(context.active(), span), () =>
    requestStore.run("request", async () => {
      assert.equal(trace.getActiveSpan(), span);
      assert.equal(isTracingSuppressed(context.active()), false);
      const exportBatch = bindTelemetryExport(async () => {
        assert.equal(requestStore.getStore(), undefined);
        assert.equal(trace.getActiveSpan(), undefined);
        assert.equal(isTracingSuppressed(context.active()), true);
        await delay(0);
        assert.equal(requestStore.getStore(), undefined);
        assert.equal(trace.getActiveSpan(), undefined);
        assert.equal(isTracingSuppressed(context.active()), true);
      });
      await exportBatch();
      assert.equal(requestStore.getStore(), "request");
      assert.equal(trace.getActiveSpan(), span);
      assert.equal(isTracingSuppressed(context.active()), false);
    })
  );
} finally {
  span.end();
  await provider.shutdown();
}
