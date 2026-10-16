import { expect, test } from "bun:test";

import { recommendationExperimentReport } from "./experiment-report";
import { benchmarkSemanticRetrieval } from "./retrieval-benchmark";

test("measures real retrieval misses against exact neighbors, excluding self matches", async () => {
  const corpus = [
    { id: "a", vector: [1, 0] },
    { id: "b", vector: [0.99, 0.01] },
    { id: "c", vector: [0, 1] },
  ];
  const perfect = await benchmarkSemanticRetrieval(
    corpus,
    corpus.slice(0, 1),
    () => Promise.resolve(["a", "b", "b"]),
    1
  );
  expect(perfect.meanRecall).toBe(1);
  const missed = await benchmarkSemanticRetrieval(
    corpus,
    corpus.slice(0, 1),
    () => Promise.resolve(["a", "c"]),
    1
  );
  expect(missed.meanRecall).toBe(0);
  expect(missed.vectorIndexEvaluationRecommended).toBe(false);
  expect(missed.enoughData).toBe(false);
});

test("experiment reports separate variants, dedupe event counts, and retain unattributed coverage", () => {
  const context = {
    rankerVersion: "v3",
    requestId: "request",
    variant: "control",
  };
  const base = { postId: "p", rankingContext: context, userId: "u" };
  const report = recommendationExperimentReport([
    { ...base, eventType: "IMPRESSION" },
    { ...base, eventType: "IMPRESSION" },
    { ...base, eventType: "BOOKMARK" },
    {
      ...base,
      eventType: "VIEW_COMPLETE",
      rankingContext: { ...context, variant: "balanced" },
    },
    { ...base, eventType: "IMPRESSION", rankingContext: null },
  ]);
  expect(report.unattributedEvents).toBe(1);
  expect(report.groups[0]?.impressions).toBe(1);
  expect(report.groups[0]?.savesPerImpression).toBe(1);
  expect(report.groups[1]?.completionsPerImpression).toBeNull();
  expect(report.unpairedEvents).toBe(1);
  expect(report.groups[1]?.completions).toBe(0);
});
