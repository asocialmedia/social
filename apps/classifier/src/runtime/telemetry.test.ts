import { expect, test } from "bun:test";

import { createClassifierTelemetry } from "./telemetry";

test("OTLP logs reach the configured OpenObserve organization and stream without credentials in records", async () => {
  const records: unknown[] = [];
  const collector = Bun.serve({
    async fetch(request) {
      expect(new URL(request.url).pathname).toBe("/api/default/v1/logs");
      expect(request.headers.get("stream-name")).toBe("asm_classifier_logs");
      expect(request.headers.get("authorization")).toBe(
        `Basic ${Buffer.from("local-user:private-test-password").toString("base64")}`
      );
      records.push(await request.json());
      return Response.json({});
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  const telemetry = createClassifierTelemetry({
    NODE_ENV: "test",
    OPENOBSERVE_LOG_STREAM: "asm_classifier_logs",
    OPENOBSERVE_PASSWORD: "private-test-password",
    OPENOBSERVE_USER: "local-user",
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collector.port}/api/default`,
    OTEL_SERVICE_NAME: "classifier",
  });
  try {
    telemetry.log("info", "classifier.otel.test", {
      completed: 1,
      startupMs: 1.25,
    });
    await telemetry.flush();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      resourceLogs: [
        {
          resource: {
            attributes: expect.arrayContaining([
              { key: "service.name", value: { stringValue: "classifier" } },
            ]),
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  attributes: expect.arrayContaining([
                    { key: "startupMs", value: { stringValue: "1.25" } },
                  ]),
                  body: { stringValue: "classifier.otel.test" },
                  severityNumber: 9,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(records)).not.toContain("private-test-password");
  } finally {
    await telemetry.shutdown();
    await collector.stop(true);
  }
});

test("collector failures do not prevent application work or graceful shutdown", async () => {
  const collector = Bun.serve({
    fetch: () => new Response(null, { status: 503 }),
    hostname: "127.0.0.1",
    port: 0,
  });
  const telemetry = createClassifierTelemetry({
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collector.port}/api/default`,
  });
  try {
    telemetry.log("warn", "classifier.export.unavailable", { failed: 1 });
    await expect(telemetry.flush()).resolves.toBeUndefined();
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  } finally {
    await collector.stop(true);
  }
});
