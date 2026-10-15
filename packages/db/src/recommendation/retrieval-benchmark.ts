import { cosineSimilarity } from "./vector";

interface VectorItem {
  id: string;
  vector: readonly number[];
}

const percentile = (values: number[], fraction: number) =>
  values.toSorted((a, b) => a - b)[
    Math.max(0, Math.ceil(values.length * fraction) - 1)
  ] ?? null;

export async function benchmarkSemanticRetrieval(
  corpus: readonly VectorItem[],
  queryItems: readonly VectorItem[],
  approximate: (query: VectorItem) => Promise<string[]>,
  cutoff = 10
) {
  const rows: {
    recall: number;
    exactMs: number;
    approximateMs: number;
    returned: number;
  }[] = [];
  for (const query of queryItems) {
    const started = performance.now();
    const exact = corpus
      .filter((item) => item.id !== query.id)
      .map((item) => ({
        id: item.id,
        similarity: cosineSimilarity(query.vector, item.vector),
      }))
      .toSorted(
        (a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id)
      )
      .slice(0, cutoff);
    const exactMs = performance.now() - started;
    const retrievalStarted = performance.now();
    // oxlint-disable-next-line no-await-in-loop -- sequential timing avoids measuring self-created contention.
    const approximateIds = await approximate(query);
    const ids = new Set(approximateIds.filter((id) => id !== query.id));
    const returned = corpus
      .filter((item) => ids.has(item.id))
      .map((item) => ({
        id: item.id,
        similarity: cosineSimilarity(query.vector, item.vector),
      }))
      .toSorted(
        (a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id)
      )
      .slice(0, cutoff);
    const relevant = new Set(exact.map((item) => item.id));
    rows.push({
      approximateMs: performance.now() - retrievalStarted,
      exactMs,
      recall: relevant.size
        ? returned.filter((item) => relevant.has(item.id)).length /
          relevant.size
        : 0,
      returned: returned.length,
    });
  }
  const recall = rows.length
    ? rows.reduce((total, row) => total + row.recall, 0) / rows.length
    : null;
  const enoughData = corpus.length >= 100 && rows.length >= 20;
  return {
    approximateP50Ms: percentile(
      rows.map((row) => row.approximateMs),
      0.5
    ),
    approximateP95Ms: percentile(
      rows.map((row) => row.approximateMs),
      0.95
    ),
    corpusSize: corpus.length,
    cutoff,
    enoughData,
    exactP95Ms: percentile(
      rows.map((row) => row.exactMs),
      0.95
    ),
    meanRecall: recall,
    queries: rows.length,
    rows,
    vectorIndexEvaluationRecommended:
      enoughData && recall !== null && recall < 0.9,
  };
}
