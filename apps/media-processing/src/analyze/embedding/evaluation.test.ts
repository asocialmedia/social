import { describe, expect, test } from "bun:test";

import { classificationReport, retrievalReport } from "./evaluation";

describe("model evaluation", () => {
  test("reports missed explicit labels separately from false positives per slice", () => {
    const report = classificationReport([
      { category: "adult", expectedExplicit: true, predictedExplicit: false },
      { category: "adult", expectedExplicit: true, predictedExplicit: true },
      { category: "anime", expectedExplicit: false, predictedExplicit: true },
      { category: "skin", expectedExplicit: false, predictedExplicit: false },
    ]);
    expect(report.overall.falseNegativeRate).toBe(0.5);
    expect(report.overall.falsePositiveRate).toBe(0.5);
    expect(report.slices.anime?.falsePositiveRate).toBe(1);
    expect(report.slices.skin?.falseNegativeRate).toBeNull();
  });
  test("scores retrieval order and prevents duplicate hits from inflating recall", () => {
    expect(retrievalReport(["a", "a", "b"], ["a", "b"])).toEqual({
      ndcg: 1,
      precision: 1,
      recall: 1,
    });
    expect(retrievalReport(["x", "a"], ["a"]).ndcg).toBeCloseTo(
      1 / Math.log2(3)
    );
    expect(retrievalReport([], [])).toEqual({
      ndcg: 0,
      precision: 0,
      recall: 0,
    });
  });
});

test("extraction evaluation measures Unicode errors and rejects synthetic evidence for rollout", async () => {
  const { textErrorRates, datasetReadiness } = await import("./evaluation");
  expect(textErrorRates("日本語", "日本語").characterErrorRate).toBe(0);
  expect(textErrorRates("one two", "one three").wordErrorRate).toBe(0.5);
  expect(textErrorRates("", "invented").characterErrorRate).toBeGreaterThan(0);
  expect(
    datasetReadiness([
      { category: "anime", reviewed: true, source: "synthetic" },
    ]).coverageGatePassed
  ).toBe(false);
});
