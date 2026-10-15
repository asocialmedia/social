// oxlint-disable-next-line typescript/triple-slash-reference -- Workspace consumers need the SQL text module declaration.
/// <reference path="../sql.d.ts" />
import sqlSource from "../sql/media-analysis.sql" with { type: "text" };
import { rawExecute, rawQuery } from "./messages/infrastructure/raw-sql";
import { readSqlBundle } from "./messages/infrastructure/sql-template";
import { redis } from "./redis";

const { mediaAnalysis } = readSqlBundle(sqlSource, {
  mediaAnalysis: ["playback", "patchMetadata", "patchStage", "coverage"],
} as const);

export async function recordMediaDelivery(
  responseBytes: number
): Promise<void> {
  if (!Number.isSafeInteger(responseBytes) || responseBytes < 0) {
    return;
  }
  try {
    const key = `media:delivery:${new Date().toISOString().slice(0, 10)}`;
    const batch = redis.multi();
    batch.hincrby(key, "responsePayloadBytes", responseBytes);
    batch.hincrby(key, "responses", 1);
    batch.expire(key, 172_800);
    await batch.exec();
  } catch {
    // Delivery counters never interfere with streaming media.
  }
}

export async function getMediaDeliveryMetrics(): Promise<
  Record<string, string>
> {
  return await redis.hgetall(
    `media:delivery:${new Date().toISOString().slice(0, 10)}`
  );
}

export async function getPlaybackMetrics() {
  const result = await rawQuery<{
    eventType: string;
    count: number;
    meanMs: number;
    p95Ms: number;
  }>(mediaAnalysis.playback, [], {
    count: "pg/int4@1",
    eventType: "pg/text@1",
    meanMs: "pg/float8@1",
    p95Ms: "pg/float8@1",
  });
  return result.rows;
}

export async function patchMediaAnalysisMetadata(
  mediaId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await rawExecute(mediaAnalysis.patchMetadata, [
    mediaId,
    JSON.stringify(metadata),
  ]);
}

// Atomic JSON patches preserve encoder metadata and independently completed stages.
export async function patchMediaAnalysisStage(
  mediaId: string,
  stage: string,
  result: Record<string, unknown>
): Promise<void> {
  await rawExecute(mediaAnalysis.patchStage, [
    mediaId,
    JSON.stringify({
      [stage]: { ...result, updatedAt: new Date().toISOString() },
    }),
  ]);
}

export async function getMediaAnalysisCoverage(): Promise<
  { pending: number; ready: number }[]
> {
  const result = await rawQuery<{ pending: number; ready: number }>(
    mediaAnalysis.coverage,
    ["clef-flash-v2"],
    { pending: { codecId: "pg/int4@1" }, ready: { codecId: "pg/int4@1" } }
  );
  return result.rows;
}
