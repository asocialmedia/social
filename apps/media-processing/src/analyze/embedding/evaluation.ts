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

function editDistance(
  reference: readonly string[],
  predicted: readonly string[]
): number {
  let previous = Array.from(
    { length: predicted.length + 1 },
    (_, index) => index
  );
  for (const [index, expected] of reference.entries()) {
    const next = [index + 1];
    for (const [offset, actual] of predicted.entries()) {
      next.push(
        Math.min(
          (next[offset] ?? 0) + 1,
          (previous[offset + 1] ?? 0) + 1,
          (previous[offset] ?? 0) + (expected === actual ? 0 : 1)
        )
      );
    }
    previous = next;
  }
  return previous[predicted.length] ?? reference.length;
}

const normalize = (text: string) =>
  text.normalize("NFC").replaceAll(/\s+/gu, " ").trim().slice(0, 10_000);
const words = (text: string) =>
  [
    ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(
      text.toLowerCase()
    ),
  ]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment);

export function textErrorRates(reference: string, predicted: string) {
  // Bound quadratic work; score literal NFC text with whitespace normalized.
  const expected = normalize(reference);
  const actual = normalize(predicted);
  const expectedWords = words(expected);
  const predictedWords = words(actual);
  return {
    characterErrorRate:
      editDistance([...expected], [...actual]) /
      Math.max(1, [...expected].length),
    referenceCharacters: [...expected].length,
    referenceWords: expectedWords.length,
    truncated: reference.length > 10_000 || predicted.length > 10_000,
    wordErrorRate:
      editDistance(expectedWords, predictedWords) /
      Math.max(1, expectedWords.length),
  };
}

export function datasetReadiness(
  items: readonly {
    category: string;
    language?: string;
    reviewed?: boolean;
    source?: string;
  }[]
) {
  const reviewed = items.filter(
    (item) => item.reviewed && item.source === "production"
  );
  const categories = Object.fromEntries(
    [...new Set(items.map((item) => item.category))].map((category) => [
      category,
      reviewed.filter((item) => item.category === category).length,
    ])
  );
  const languages = Object.fromEntries(
    [...new Set(items.map((item) => item.language ?? "unknown"))].map(
      (language) => [
        language,
        reviewed.filter((item) => item.language === language).length,
      ]
    )
  );
  return {
    categories,
    coverageGatePassed:
      reviewed.length >= 100 &&
      Object.values(categories).every((count) => count >= 10) &&
      reviewed.length === items.length &&
      [
        "anime",
        "ordinary-skin",
        "adult",
        "graphic-violence",
        "memes",
        "screenshots",
        "video",
      ].every((category) => (categories[category] ?? 0) >= 10) &&
      Object.entries(languages).filter(
        ([language, count]) =>
          !["unknown", "und", ""].includes(language) && count >= 10
      ).length >= 2,
    languages,
    productionReviewed: reviewed.length,
  };
}
