import { describe, expect, test } from "bun:test";
import { readOtelConfig } from "./otel-config";
import { createOtlpLogDestination } from "./otlp-log-destination";

describe("otel-config", () => {
  test("reads OpenObserve endpoint and auth from env", () => {
    const config = readOtelConfig({
      OPENOBSERVE_ENDPOINT: "http://localhost:5080",
      OPENOBSERVE_USER: "root@example.com",
      OPENOBSERVE_PASSWORD: "Complexpass#123",
      OPENOBSERVE_ORG: "default",
      OPENOBSERVE_ENABLED: "true",
      OTEL_SERVICE_NAME: "auth",
      NODE_ENV: "production",
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
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer abc,stream-name=logs",
      NODE_ENV: "production",
      OTEL_ENABLED: "true",
    });
    expect(config.headers.Authorization).toBe("Bearer abc");
    expect(config.headers["stream-name"]).toBe("logs");
  });
});

describe("otlp-log-destination", () => {
  test("builds an OTLP log payload and posts it", async () => {
    const posted: Array<{ url: string; body: string }> = [];

    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      posted.push({
        url: String(url),
        body: String(init?.body ?? ""),
      });
      return Promise.resolve(
        new Response(JSON.stringify({ code: 200 }), { status: 200 })
      );
    }) as typeof fetch;

    const dest = createOtlpLogDestination({
      endpoint: "http://localhost:5080/api/default/v1/logs",
      headers: { Authorization: "Basic abc" },
      serviceName: "auth-test",
      batchSize: 1,
      flushIntervalMs: 100,
    });

    const done = new Promise<void>((resolve) => {
      dest.write(
        JSON.stringify({
          level: 30,
          time: "2026-01-01T00:00:00.000Z",
          msg: "hello",
          service: "auth",
        }),
        () => {
          setTimeout(resolve, 50);
        }
      );
    });

    await done;

    expect(posted.length).toBeGreaterThan(0);
    const [record] = posted;
    expect(record.url).toContain("/v1/logs");
    expect(record.body).toContain("hello");
    expect(record.body).toContain("severityText");
  });
});
