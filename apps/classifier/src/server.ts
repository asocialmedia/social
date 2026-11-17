import { createClassifierApp } from "./http/app";
import { createClassifier } from "./inference/inference";
import { maxImageBytes, model } from "./inference/model";
import { classifierConfig } from "./runtime/config";
import { createClassifierTelemetry } from "./runtime/telemetry";

const start = performance.now();
const telemetry = createClassifierTelemetry(process.env);
const config = classifierConfig(process.env);
const classifier = await createClassifier(config.modelPath, config.threads);
const handler = createClassifierApp(config, classifier.classify);
let completed = 0;
let failed = 0;
let rejected = 0;
let totalMs = 0;
const summary = setInterval(() => {
  if (completed + failed + rejected > 0) {
    // Client rejections (4xx) are expected validation; only 5xx warn.
    telemetry.log(failed ? "warn" : "info", "classifier.requests", {
      completed,
      failed,
      meanDurationMs: totalMs / (completed + failed + rejected),
      rejected,
    });
    completed = 0;
    failed = 0;
    rejected = 0;
    totalMs = 0;
  }
}, 30_000);
summary.unref();
const server = Bun.serve({
  error: () => Response.json({ error: "invalid_request" }, { status: 400 }),
  async fetch(request) {
    const started = performance.now();
    const response = await handler(request);
    if (new URL(request.url).pathname === "/v1/classify") {
      if (response.ok) {
        completed += 1;
      } else if (response.status === 500) {
        failed += 1;
      } else {
        rejected += 1;
      }
      totalMs += performance.now() - started;
    }
    return response;
  },
  hostname: "0.0.0.0",
  idleTimeout: 15,
  maxRequestBodySize: maxImageBytes + 64 * 1024,
  port: config.port,
});
telemetry.log("info", "classifier.ready", {
  "model.id": model.id,
  "model.revision": model.revision,
  port: server.port ?? config.port,
  startupMs: performance.now() - start,
  threads: config.threads,
});
const stop = async () => {
  clearInterval(summary);
  await server.stop();
  await classifier.close();
  telemetry.log("info", "classifier.stopped", {
    completed,
    failed,
    rejected,
  });
  await telemetry.shutdown();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
