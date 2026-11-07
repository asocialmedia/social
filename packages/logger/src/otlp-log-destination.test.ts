import { describe, expect, spyOn, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";

import { createOtlpLogDestination } from "./otlp-log-destination";

describe("OTLP log destination", () => {
  for (const trigger of ["batch", "timer", "shutdown"] as const) {
    test(`exports outside the render context on ${trigger}`, async () => {
      const renderStore = new AsyncLocalStorage<string>();
      const { promise: exported, resolve: resolveExport } =
        Promise.withResolvers<undefined>();
      let payload = "";
      const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
        Object.assign(
          async (_url: URL | RequestInfo, init?: RequestInit) => {
            expect(renderStore.getStore()).toBeUndefined();
            await Promise.resolve();
            expect(renderStore.getStore()).toBeUndefined();
            payload = String(init?.body);
            resolveExport();
            return new Response(null, { status: 200 });
          },
          { preconnect: globalThis.fetch.preconnect }
        )
      );
      const destination = createOtlpLogDestination({
        batchSize: trigger === "batch" ? 1 : 100,
        endpoint: "https://telemetry.invalid/v1/logs",
        flushIntervalMs: trigger === "timer" ? 1 : 60_000,
        headers: {},
      });
      try {
        renderStore.run("prerender", () => {
          destination.write(
            JSON.stringify({
              level: 30,
              msg: "test message",
              time: "2026-11-07T00:00:00.000Z",
              trace_id: "original-request-trace",
            })
          );
          if (trigger === "shutdown") {
            destination.end();
          }
          expect(renderStore.getStore()).toBe("prerender");
        });
        await exported;
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(payload).toContain("original-request-trace");
        expect(payload).toContain("test message");
      } finally {
        if (!destination.writableEnded) {
          const finished = once(destination, "finish");
          destination.end();
          await finished;
        }
        fetchMock.mockRestore();
      }
    });
  }
});
