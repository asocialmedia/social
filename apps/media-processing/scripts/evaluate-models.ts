import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import {
  classificationReport,
  datasetReadiness,
  textErrorRates,
  retrievalReport,
} from "../src/analyze/evaluation";
import { loadRootEnv } from "../src/load-env";

const itemSchema = z.object({
  category: z.string(),
  expectedOcr: z.string().optional(),
  expectedTranscript: z.string().optional(),
  explicit: z.boolean(),
  id: z.string(),
  kind: z.enum(["text", "image", "audio", "video"]),
  language: z.string().default("unknown"),
  path: z.string().optional(),
  reviewed: z.boolean().default(false),
  source: z
    .enum(["synthetic", "production", "unverified"])
    .default("synthetic"),
  text: z.string().default(""),
});
const manifestSchema = z.object({
  items: z.array(itemSchema).min(1).max(200),
  queries: z
    .array(z.object({ relevantIds: z.array(z.string()), text: z.string() }))
    .default([]),
});

async function main() {
  const [
    manifestPath,
    outputPath = "/tmp/asm-model-evaluation.json",
    ...flags
  ] = process.argv.slice(2);
  if (!manifestPath) {
    throw new Error(
      "Usage: bun apps/media-processing/scripts/evaluate-models.ts manifest.json [report.json] [--live]"
    );
  }
  const manifest = manifestSchema.parse(await Bun.file(manifestPath).json());
  const ids = new Set(manifest.items.map((item) => item.id));
  if (
    ids.size !== manifest.items.length ||
    manifest.queries.some((query) =>
      query.relevantIds.some((id) => !ids.has(id))
    )
  ) {
    throw new Error(
      "Manifest IDs must be unique and query labels must refer to manifest items"
    );
  }
  for (const item of manifest.items) {
    if (
      item.kind !== "text" &&
      (!item.path ||
        !(await Bun.file(
          path.resolve(path.dirname(manifestPath), item.path)
        ).exists()))
    ) {
      throw new Error(`Missing local evaluation asset: ${item.id}`);
    }
  }
  if (!flags.includes("--live")) {
    console.log(
      JSON.stringify({
        items: manifest.items.length,
        mode: "validated-only",
        queries: manifest.queries.length,
        readiness: datasetReadiness(manifest.items),
      })
    );
    return;
  }
  if (
    flags.includes("--require-reviewed") &&
    !datasetReadiness(manifest.items).coverageGatePassed
  ) {
    throw new Error(
      "Dataset lacks reviewed production coverage; no provider calls made"
    );
  }
  loadRootEnv();
  const { evaluateClef, clefSafetyVerdict, prepareClefImage } =
    await import("../src/analyze/clef");
  const { generateTextEmbedding, cosineSimilarity } =
    await import("../src/analyze/embedding");
  const { extractImageText } = await import("../src/analyze/ocr");
  const { transcribeViaGemini, extractAudioTrack } =
    await import("../src/analyze/transcribe");
  const extractionResults: {
    id: string;
    language: string;
    kind: string;
    latencyMs: number;
    metrics: ReturnType<typeof textErrorRates>;
  }[] = [];
  const { extractVideoSamples } = await import("../src/analyze/video-samples");
  const { runFfmpeg } = await import("../src/transcode/ffmpeg");
  const { closePrisma, closeQueueConnections, redis } = await import("@asm/db");
  const directory = await mkdtemp(path.join(tmpdir(), "asm-model-evaluation-"));
  const rows: {
    category: string;
    expectedExplicit: boolean;
    id: string;
    inputTokens: number;
    latencyMs: number;
    model: string;
    neurons: number;
    predictedExplicit: boolean;
  }[] = [];
  const embeddings: { id: string; media: number[]; text: number[] }[] = [];
  try {
    for (const item of manifest.items) {
      const assetPath = item.path
        ? path.resolve(path.dirname(manifestPath), item.path)
        : undefined;
      const frames: string[] = [];
      let audio: Buffer | undefined;
      let video: Buffer | undefined;
      if (assetPath && item.kind === "video") {
        const sampleSource = path.join(
          directory,
          `${embeddings.length}-source`
        );
        await Bun.write(sampleSource, Bun.file(assetPath));
        await extractVideoSamples(sampleSource, frames);
        const clip = path.join(directory, `${embeddings.length}.mp4`);
        await runFfmpeg(
          [
            "-i",
            assetPath,
            "-t",
            "20",
            "-vf",
            "scale=480:480:force_original_aspect_ratio=decrease",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "28",
            "-c:a",
            "aac",
            "-b:a",
            "48k",
            "-y",
            clip,
          ],
          60_000
        );
        video = Buffer.from(await Bun.file(clip).arrayBuffer());
        if (video.length > 16 * 1024 * 1024) {
          throw new Error(`Video sample exceeds Clef inline limit: ${item.id}`);
        }
      }
      if (assetPath && item.kind === "audio") {
        const clip = path.join(directory, `${embeddings.length}.mp3`);
        await runFfmpeg(
          [
            "-i",
            assetPath,
            "-t",
            "20",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-b:a",
            "32k",
            "-y",
            clip,
          ],
          30_000
        );
        audio = Buffer.from(await Bun.file(clip).arrayBuffer());
      }
      const imagePaths =
        item.kind === "image" && assetPath ? [assetPath] : frames;
      if (
        flags.includes("--extraction") &&
        item.expectedOcr !== undefined &&
        imagePaths[0]
      ) {
        const started = performance.now();
        const ocr = await extractImageText(imagePaths[0]);
        if (!ocr) {
          throw new Error(`OCR unavailable for ${item.id}`);
        }
        extractionResults.push({
          id: item.id,
          kind: "ocr",
          language: item.language,
          latencyMs: performance.now() - started,
          metrics: textErrorRates(item.expectedOcr, ocr.text),
        });
      }
      if (
        flags.includes("--extraction") &&
        item.expectedTranscript !== undefined &&
        assetPath &&
        ["audio", "video"].includes(item.kind)
      ) {
        const started = performance.now();
        const track = path.join(
          directory,
          `${item.id.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}.ogg`
        );
        if (!(await extractAudioTrack(assetPath, track))) {
          throw new Error(`Missing evaluation audio for ${item.id}`);
        }
        const transcript = await transcribeViaGemini(track);
        if (transcript.status !== "completed") {
          throw new Error(`Transcription unavailable for ${item.id}`);
        }
        extractionResults.push({
          id: item.id,
          kind: "transcript",
          language: item.language,
          latencyMs: performance.now() - started,
          metrics: textErrorRates(
            item.expectedTranscript,
            transcript.transcript
          ),
        });
      }
      for (const model of ["clef-flash", "clef-omni"] as const) {
        let inputTokens = 0;
        let neurons = 0;
        const started = performance.now();
        const decision = await evaluateClef({
          ...(model === "clef-omni" && audio
            ? { audio: { data: audio, mimeType: "audio/mpeg" as const } }
            : {}),
          ...(model === "clef-omni" && video
            ? { video: { data: video, mimeType: "video/mp4" as const } }
            : { imagePaths }),
          model,
          onUsage: (usage) => {
            ({ inputTokens, neurons } = usage);
          },
          text: item.text,
        });
        rows.push({
          category: item.category,
          expectedExplicit: item.explicit,
          id: item.id,
          inputTokens,
          latencyMs: performance.now() - started,
          model,
          neurons,
          predictedExplicit: clefSafetyVerdict(decision).explicit,
        });
      }
      const text = await generateTextEmbedding(item.text);
      const mediaParts = await Promise.all(
        imagePaths.map(async (imagePath) => ({
          data: await prepareClefImage(imagePath),
          mimeType: "image/jpeg" as const,
        }))
      );
      const media = await generateTextEmbedding(
        item.text,
        audio
          ? [{ data: audio, mimeType: "audio/mpeg" }, ...mediaParts]
          : mediaParts
      );
      embeddings.push({ id: item.id, media, text });
      for (const frame of frames) {
        await Bun.file(frame).delete();
      }
    }
    const retrieval = [];
    for (const query of manifest.queries) {
      const vector = await generateTextEmbedding(query.text);
      if (!vector.some(Boolean)) {
        throw new Error("Evaluation query embedding unavailable");
      }
      const ranked = (kind: "text" | "media") =>
        embeddings
          .filter((entry) => entry[kind].some(Boolean))
          .toSorted(
            (a, b) =>
              cosineSimilarity(vector, b[kind]) -
              cosineSimilarity(vector, a[kind])
          )
          .map((entry) => entry.id);
      retrieval.push({
        media: retrievalReport(ranked("media"), query.relevantIds),
        query: query.text,
        text: retrievalReport(ranked("text"), query.relevantIds),
      });
    }
    const report = {
      classification: Object.fromEntries(
        ["clef-flash", "clef-omni"].map((model) => [
          model,
          classificationReport(rows.filter((row) => row.model === model)),
        ])
      ),
      createdAt: new Date().toISOString(),
      dataset: datasetReadiness(manifest.items),
      extractionResults,
      note: "Cached calls consume zero new neurons. Synthetic fixtures verify integration, not representative accuracy. AV comparisons use at most 20 seconds; Flash uses the supplied transcript and sampled frames.",
      retrieval,
      rows,
    };
    await Bun.write(outputPath, JSON.stringify(report, null, 2));
    console.log(`Saved ${rows.length} classification results to ${outputPath}`);
  } finally {
    await rm(directory, { force: true, recursive: true });
    await closeQueueConnections();
    await closePrisma();
    redis.disconnect();
  }
}

if (import.meta.main) {
  await main();
}
