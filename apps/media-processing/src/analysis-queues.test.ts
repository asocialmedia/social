import { expect, mock, test } from "bun:test";

import { configureAnalysisQueues } from "./analysis-queues";

test("all replicas share bounded analysis concurrency and external safety throughput", async () => {
  const analyze = {
    setGlobalConcurrency: mock((_value: number) => Promise.resolve(1)),
    setGlobalRateLimit: mock((_max: number, _duration: number) =>
      Promise.resolve(2)
    ),
  };
  const externalSafety = {
    setGlobalConcurrency: mock((_value: number) => Promise.resolve(1)),
    setGlobalRateLimit: mock((_max: number, _duration: number) =>
      Promise.resolve(2)
    ),
  };
  await configureAnalysisQueues({ analyze, externalSafety });
  expect(analyze.setGlobalConcurrency).toHaveBeenCalledWith(1);
  expect(externalSafety.setGlobalConcurrency).toHaveBeenCalledWith(1);
  expect(externalSafety.setGlobalRateLimit).toHaveBeenCalledWith(2, 1000);
});
