import { beforeEach, expect, mock, test } from "bun:test";

const span = {
  end: mock(),
  setAttribute: mock(),
  setStatus: mock(),
  spanContext: () => ({ spanId: "test-span", traceId: "test-trace" }),
};
mock.module("@opentelemetry/api", () => ({
  SpanStatusCode: { ERROR: 2, OK: 1, UNSET: 0 },
  context: { active: () => ({}) },
  metrics: {
    getMeter: () => ({
      createCounter: () => ({ add() {} }),
      createHistogram: () => ({ record() {} }),
    }),
  },
  propagation: { extract: () => ({}) },
  trace: {
    getTracer: () => ({
      startActiveSpan: (
        _name: string,
        _options: unknown,
        _context: unknown,
        run: (activeSpan: typeof span) => Promise<unknown>
      ) => run(span),
    }),
  },
}));
const { observeRequest } = await import("./observability");
const { DelayedError } = await import("bullmq");
const logger = { debug: mock(), error: mock(), info: mock(), warn: mock() };
const request = new Request("http://protocols.internal/ingestion");
const options = {
  isDeferredError: (error: unknown) => error instanceof DelayedError,
};
beforeEach(() => {
  span.end.mockClear();
  span.setAttribute.mockClear();
  span.setStatus.mockClear();
  logger.debug.mockClear();
  logger.warn.mockClear();
});

test("durably deferred hydration retains queue control flow without an error span or warning", async () => {
  const deferred = new DelayedError();
  await expect(
    observeRequest(
      "ingestion.hydrate",
      request,
      "deferred",
      logger,
      () => Promise.reject(deferred),
      options
    )
  ).rejects.toBe(deferred);
  expect(span.setStatus).toHaveBeenCalledWith({ code: 0, message: "deferred" });
  expect(span.setAttribute).toHaveBeenCalledWith(
    "asm.request.outcome",
    "deferred"
  );
  expect(logger.warn).not.toHaveBeenCalled();
  expect(logger.debug.mock.calls[0]?.[1]).toBe("Protocol request deferred");
  expect(span.end).toHaveBeenCalledTimes(1);
});

test("failure to persist a delay and terminal hydration failures still produce error spans", async () => {
  const failure = new Error("Redis unavailable while persisting a delay");
  await expect(
    observeRequest(
      "ingestion.hydrate",
      request,
      "failed",
      logger,
      () => Promise.reject(failure),
      options
    )
  ).rejects.toBe(failure);
  expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: "internal" });
  expect(span.setAttribute).toHaveBeenCalledWith(
    "asm.request.outcome",
    "error"
  );
  expect(logger.warn).toHaveBeenCalledTimes(1);
  expect(span.end).toHaveBeenCalledTimes(1);
});

test("request failures are errors by default even if they resemble queue control flow", async () => {
  await expect(
    observeRequest("bluesky.posts", request, "request", logger, () =>
      Promise.reject(new DelayedError())
    )
  ).rejects.toBeInstanceOf(DelayedError);
  expect(span.setStatus).toHaveBeenCalledWith({ code: 2, message: "internal" });
  expect(logger.warn).toHaveBeenCalledTimes(1);
});
