import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { getWebLogger, initWebTelemetry } from "./otel";

const ORIGINAL_CONSOLE = { ...console };

function captureConsole(method: "error" | "warn" | "info" | "log" | "debug") {
  const calls: unknown[][] = [];
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    calls.push(args);
  };
  return {
    calls,
    restore: () => {
      console[method] = original;
    },
  };
}

let oldFetch: typeof fetch | undefined;
let posted: { body: string; headers: Record<string, string>; url: string }[];

beforeEach(() => {
  delete (process.env as Record<string, string | undefined>)
    .OTEL_EXPORTER_OTLP_ENDPOINT;
  delete (process.env as Record<string, string | undefined>).PNPM_HOME;
  process.env.NEXT_RUNTIME = "nodejs";
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://o11y.test/api/default";
  process.env.OPENOBSERVE_LOG_STREAM = "asm_web_logs";
  process.env.OPENOBSERVE_USER = "dev@example.com";
  process.env.OPENOBSERVE_PASSWORD = "secret";

  posted = [];
  oldFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    posted.push({
      body: String(init?.body ?? ""),
      headers: (init?.headers ?? {}) as Record<string, string>,
      url: String(url),
    });
    return Promise.resolve(Response.json({ code: 200 }, { status: 200 }));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = oldFetch ?? globalThis.fetch;
  console.error = ORIGINAL_CONSOLE.error;
  console.warn = ORIGINAL_CONSOLE.warn;
  console.info = ORIGINAL_CONSOLE.info;
  console.log = ORIGINAL_CONSOLE.log;
  console.debug = ORIGINAL_CONSOLE.debug;
  delete (process.env as Record<string, string | undefined>).NEXT_RUNTIME;
});

describe("web telemetry", () => {
  test("is a no-op on non-node runtimes", () => {
    process.env.NEXT_RUNTIME = "edge";
    initWebTelemetry();
    expect(getWebLogger()).toBeUndefined();
  });

  test("is a no-op without an OTLP endpoint", () => {
    delete (process.env as Record<string, string | undefined>)
      .OTEL_EXPORTER_OTLP_ENDPOINT;
    initWebTelemetry();
    expect(getWebLogger()).toBeUndefined();
  });

  test("boots the logger and forwards console.error as a log", async () => {
    const { calls, restore } = captureConsole("error");
    initWebTelemetry();
    expect(getWebLogger()).toBeDefined();

    console.error("boom", new Error("kaboom"));

    // Let the batching OTLP destination flush (2s interval).
    await Bun.sleep(2100);

    restore();

    expect(calls.length).toBe(1);
    const exported = posted.find((entry) => entry.url.includes("/v1/logs"));
    expect(exported).toBeDefined();
    if (exported) {
      expect(exported.url).toContain("/v1/logs");
      expect(exported.body).toContain("boom");
      expect(exported.body).toContain("kaboom");
      expect(exported.headers["stream-name"]).toBe("asm_web_logs");
    }
  });
});
