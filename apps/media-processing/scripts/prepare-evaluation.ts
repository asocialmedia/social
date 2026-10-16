import path from "node:path";

import { closePrisma, closeQueueConnections, prisma, redis } from "@asm/db";

import { getS3 } from "../src/s3";

const output =
  process.argv.find((argument) => argument.startsWith("--output="))?.slice(9) ??
  "/tmp/asm-evaluation-draft/manifest.json";
const download = process.argv.includes("--download");
try {
  const rows = await prisma.orm.public.PostMedia.select(
    "id",
    "_type",
    "publishedKey",
    "ocrText",
    "transcript",
    "semanticTags"
  )
    .include("post", (post) => post.select("explicitContent"))
    .where({ status: "READY" })
    .orderBy((media) => media.id.asc())
    .limit(100)
    .all();
  const items = [];
  for (const row of rows) {
    if (!["IMAGE", "VIDEO", "AUDIO"].includes(row._type) || !row.publishedKey) {
      continue;
    }
    const file = `${row.id}.asset`;
    if (download) {
      await Bun.write(
        path.join(path.dirname(path.resolve(output)), file),
        getS3().file(row.publishedKey)
      );
    }
    items.push({
      category: row.semanticTags?.[0] ?? "unreviewed",
      explicit: row.post?.explicitContent ?? false,
      id: row.id,
      kind: row._type.toLowerCase(),
      language: "unknown",
      path: file,
      reviewed: false,
      source: "unverified",
      text: [row.ocrText, row.transcript].filter(Boolean).join("\n"),
    });
  }
  await Bun.write(
    output,
    JSON.stringify(
      {
        items,
        queries: [],
        reviewInstructions:
          "DRAFT: stored labels and text are candidates, not ground truth. Verify source, language, category, explicit labels, literal expectedOcr/expectedTranscript, query relevance, and rights to use assets before marking reviewed. Downloads are opt-in; do not call providers until reviewed.",
      },
      null,
      2
    )
  );
  console.log(
    JSON.stringify({ downloaded: download, items: items.length, output })
  );
} finally {
  await closePrisma();
  await closeQueueConnections();
  redis.disconnect();
}
