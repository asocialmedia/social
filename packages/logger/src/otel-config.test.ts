import { describe, expect, test } from "bun:test";

import { readOtelConfig, resolveLogStreamName } from "./otel-config";
import { createOtlpLogDestination } from "./otlp-log-destination";

describe("otel-config", () => {
  test("reads OpenObserve endpoint and auth from env", () => {
    const config = readOtelConfig({
      NODE_ENV: "production",
      OPENOBSERVE_ENABLED: "true",
      OPENOBSERVE_ENDPOINT: "http://localhost:5080",
      OPENOBSERVE_ORG: "default",
      OPENOBSERVE_PASSWORD: "Complexpass#123",
      OPENOBSERVE_USER: "root@example.com",
      OTEL_SERVICE_NAME: "auth",
    });

    expect(config.enabled).toBe(true);
    expect(config.endpoint).toBe("http://localhost:5080");
    expect(config.serviceName).toBe("auth");
    expect(config.organization).toBe("default");
    expect(config.headers.Authorization).toContain("Basic ");
  });

  test("disables telemetry in test env by default", () => {
    const config = readOtelConfig({ NODE_ENV: "test" });
    expect(config.enabled).toBe(false);
  });

  test("parses OTEL_EXPORTER_OTLP_HEADERS", () => {
    const config = readOtelConfig({
      NODE_ENV: "production",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer abc,stream-name=logs",
    });
    expect(config.headers.Authorization).toBe("Bearer abc");
    expect(config.headers["stream-name"]).toBe("logs");
  });
});

describe("resolve-log-stream-name", () => {
  test("prefers OPENOBSERVE_LOG_STREAM for per-project organization", () => {
    const stream = resolveLogStreamName({
      OPENOBSERVE_LOG_STREAM: "asm_auth_logs",
      OTEL_SERVICE_NAME: "auth",
    });
    expect(stream).toBe("asm_auth_logs");
  });

  test("falls back to default_<service> without explicit streams", () => {
    const stream = resolveLogStreamName({ OTEL_SERVICE_NAME: "web" });
    expect(stream).toBe("default_web");
  });

  test("falls back to default with no configuration", () => {
    const stream = resolveLogStreamName({});
    expect(stream).toBe("default");
  });

  test("falls back through OPENOBSERVE_STREAM and ZO_STREAM", () => {
    expect(resolveLogStreamName({ OPENOBSERVE_STREAM: "asm_web_logs" })).toBe(
      "asm_web_logs"
    );
    expect(resolveLogStreamName({ ZO_STREAM: "asm_web_logs" })).toBe(
      "asm_web_logs"
    );
  });
});

describe("otlp-log-destination", () => {
  test("builds an OTLP log payload and posts it", async () => {
    const posted: { url: string; body: string }[] = [];

    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      posted.push({
        body: String(init?.body ?? ""),
        url: String(url),
      });
      return Promise.resolve(Response.json({ code: 200 }, { status: 200 }));
    }) as typeof fetch;

    const dest = createOtlpLogDestination({
      batchSize: 1,
      endpoint: "http://localhost:5080/api/default/v1/logs",
      flushIntervalMs: 100,
      headers: { Authorization: "Basic abc" },
      serviceName: "auth-test",
    });

    dest.write(
      JSON.stringify({
        level: 30,
        msg: "hello",
        service: "auth",
        time: "2026-01-01T00:00:00.000Z",
      })
    );

    // Give the batching stream time to flush the single queued record.
    await Bun.sleep(100);

    expect(posted.length).toBeGreaterThan(0);
    const [record] = posted;
    expect(record.url).toContain("/v1/logs");
    expect(record.body).toContain("hello");
    expect(record.body).toContain("severityText");
  });
});
