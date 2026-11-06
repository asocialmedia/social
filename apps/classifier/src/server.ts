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
let totalMs = 0;
const summary = setInterval(() => {
  if (completed + failed > 0) {
    telemetry.log(failed ? "warn" : "info", "classifier.requests", {
      completed,
      failed,
      meanDurationMs: totalMs / (completed + failed),
    });
    completed = 0;
    failed = 0;
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
      } else {
        failed += 1;
      }
      totalMs += performance.now() - started;
    }
    return response;
  },
  hostname: "0.0.0.0",
  idleTimeout: 15,
  maxRequestBodySize: maxImageBytes,
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
  telemetry.log("info", "classifier.stopped", { completed, failed });
  await telemetry.shutdown();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
