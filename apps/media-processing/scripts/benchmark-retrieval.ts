import {
  benchmarkSemanticRetrieval,
  closePrisma,
  closeQueueConnections,
  fromPrismaDateTime,
  prisma,
  redis,
  retrieveSemanticCandidates,
  indexPostEmbedding,
} from "@asm/db";

import { embeddingModelId } from "../src/analyze/embedding/embedding";

const model = embeddingModelId();
try {
  const rows = await prisma.orm.public.Posts.select(
    "id",
    "embedding",
    "createdAt"
  )
    .where({ embeddingModel: model })
    .orderBy((post) => post.id.asc())
    .limit(5000)
    .all();
  const corpus = rows
    .filter(
      (row) =>
        row.embedding?.length === 384 && row.embedding.every(Number.isFinite)
    )
    .map((row) => ({ id: row.id, vector: [...(row.embedding ?? [])] }));
  if (process.argv.includes("--reindex")) {
    for (const row of rows) {
      await indexPostEmbedding(
        row.id,
        model,
        row.embedding ?? [],
        fromPrismaDateTime(row.createdAt).getTime()
      );
    }
  }
  const queries = corpus
    .filter(
      (_, index) => index % Math.max(1, Math.floor(corpus.length / 50)) === 0
    )
    .slice(0, 50);
  const report = await benchmarkSemanticRetrieval(corpus, queries, (query) =>
    retrieveSemanticCandidates(model, query.vector)
  );
  const output =
    process.argv
      .find((argument) => argument.startsWith("--output="))
      ?.slice(9) ?? "/tmp/asm-retrieval-benchmark.json";
  await Bun.write(
    output,
    JSON.stringify(
      { ...report, corpusLimit: 5000, model, sampled: true },
      null,
      2
    )
  );
  console.log(
    JSON.stringify({
      corpus: report.corpusSize,
      enoughData: report.enoughData,
      output,
      queries: report.queries,
      recall: report.meanRecall,
    })
  );
} finally {
  await closePrisma();
  await closeQueueConnections();
  redis.disconnect();
}
