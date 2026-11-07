import { describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { bindTelemetryExport } from "./telemetry-context";

describe("telemetry export context", () => {
  test("suppresses tracing with an active SDK context manager", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        fileURLToPath(new URL("telemetry-context.fixture.ts", import.meta.url)),
      ],
      { stderr: "pipe", stdout: "pipe" }
    );
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("detaches render and request stores, including async export work", async () => {
    const renderStore = new AsyncLocalStorage<string>();
    const requestStore = new AsyncLocalStorage<string>();
    const exportBatch = bindTelemetryExport(async (payload: string[]) => {
      expect(renderStore.getStore()).toBeUndefined();
      expect(requestStore.getStore()).toBeUndefined();
      await delay(0);
      expect(renderStore.getStore()).toBeUndefined();
      expect(requestStore.getStore()).toBeUndefined();
      return payload;
    });

    const payload = ["span-with-original-request-ids"];
    await renderStore.run("prerender", () =>
      requestStore.run("request", async () => {
        expect(await exportBatch(payload)).toBe(payload);
        expect(renderStore.getStore()).toBe("prerender");
        expect(requestStore.getStore()).toBe("request");
      })
    );
  });

  test("preserves exporter receiver, callback result and thrown errors", () => {
    const renderStore = new AsyncLocalStorage<string>();
    const exporter = {
      // eslint-disable-next-line promise/prefer-await-to-callbacks -- Exercises the SDK exporter callback contract.
      export(batch: string[], callback: (count: number) => void) {
        expect(renderStore.getStore()).toBeUndefined();
        this.sent += batch.length;
        // eslint-disable-next-line promise/prefer-await-to-callbacks -- Exercises the SDK exporter callback contract.
        callback(this.sent);
      },
      sent: 0,
    };
    exporter.export = bindTelemetryExport(exporter.export.bind(exporter));
    const fail = bindTelemetryExport(() => {
      throw new Error("export failed");
    });
    renderStore.run("prerender", () => {
      let result = 0;
      exporter.export(["span"], (count) => {
        result = count;
      });
      expect(result).toBe(1);
      expect(() => fail()).toThrow("export failed");
      expect(renderStore.getStore()).toBe("prerender");
    });
  });
});
