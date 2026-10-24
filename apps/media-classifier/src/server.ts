import { createClassifierApp } from "./app";
import { classifierConfig } from "./config";
import { createClassifier } from "./inference";
import { maxImageBytes, model } from "./model";

const start = performance.now();
const config = classifierConfig(process.env);
const classifier = await createClassifier(config.modelPath, config.threads);
const server = Bun.serve({
  error: () => Response.json({ error: "invalid_request" }, { status: 400 }),
  fetch: createClassifierApp(config, classifier.classify),
  hostname: "0.0.0.0",
  idleTimeout: 15,
  maxRequestBodySize: maxImageBytes,
  port: config.port,
});
console.info(
  JSON.stringify({
    event: "classifier.ready",
    model,
    port: server.port,
    startupMs: performance.now() - start,
    threads: config.threads,
  })
);
const stop = async () => {
  await server.stop();
  await classifier.close();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
