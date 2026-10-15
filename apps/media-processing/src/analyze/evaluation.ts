function report(rows: readonly EvaluationCase[]) {
  const truePositive = rows.filter(
    (row) => row.expectedExplicit && row.predictedExplicit
  ).length;
  const falsePositive = rows.filter(
    (row) => !row.expectedExplicit && row.predictedExplicit
  ).length;
  const falseNegative = rows.filter(
    (row) => row.expectedExplicit && !row.predictedExplicit
  ).length;
  const trueNegative =
    rows.length - truePositive - falsePositive - falseNegative;
  return {
    count: rows.length,
    falseNegative,
    falseNegativeRate:
      truePositive + falseNegative
        ? falseNegative / (truePositive + falseNegative)
        : null,
    falsePositive,
    falsePositiveRate:
      trueNegative + falsePositive
        ? falsePositive / (trueNegative + falsePositive)
        : null,
    trueNegative,
    truePositive,
  };
}

export interface EvaluationCase {
  category: string;
  expectedExplicit: boolean;
  predictedExplicit: boolean;
}

export function classificationReport(cases: readonly EvaluationCase[]) {
  return {
    overall: report(cases),
    slices: Object.fromEntries(
      [...new Set(cases.map((row) => row.category))]
        .toSorted()
        .map((category) => [
          category,
          report(cases.filter((row) => row.category === category)),
        ])
    ),
  };
}

export function retrievalReport(
  rankedIds: readonly string[],
  relevantIds: readonly string[],
  cutoff = 10
) {
  const relevant = new Set(relevantIds);
  const ranked = [...new Set(rankedIds)].slice(0, Math.max(1, cutoff));
  const hits = ranked.filter((id) => relevant.has(id)).length;
  const dcg = ranked.reduce(
    (sum, id, index) => sum + (relevant.has(id) ? 1 / Math.log2(index + 2) : 0),
    0
  );
  const ideal = Array.from(
    { length: Math.min(relevant.size, ranked.length) },
    (_, index) => 1 / Math.log2(index + 2)
  ).reduce((sum, value) => sum + value, 0);
  return {
    ndcg: ideal ? dcg / ideal : 0,
    precision: ranked.length ? hits / ranked.length : 0,
    recall: relevant.size ? hits / relevant.size : 0,
  };
}
