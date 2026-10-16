import { expect, test } from "bun:test";

import {
  getMediaAnalysisCoverage,
  getPlaybackMetrics,
  patchMediaAnalysisMetadata,
  patchMediaAnalysisStage,
  prisma,
} from "@asm/db";

test("independent analysis stages patch metadata without losing concurrent encoder fields", async () => {
  const id = `analysis-it-${crypto.randomUUID()}`;
  await prisma.orm.public.Users.create({
    displayName: "Analysis fixture",
    email: `${id}@example.test`,
    id,
    username: id,
  });
  try {
    await prisma.orm.public.PostMedia.create({
      _type: "AUDIO",
      id,
      key: `${id}.mp3`,
      mimeType: "audio/mpeg",
      size: 1,
      status: "READY",
      techMetadata: { codec: "mp3", duration: 20 },
      url: "https://example.test/fixture",
      userId: id,
    });
    await Promise.all([
      patchMediaAnalysisStage(id, "ocr", { status: "completed", version: 1 }),
      patchMediaAnalysisStage(id, "transcription", {
        status: "silent",
        version: 1,
      }),
      patchMediaAnalysisMetadata(id, {
        semanticClassificationVersion: "test-v1",
      }),
    ]);
    const media = await prisma.orm.public.PostMedia.select("techMetadata")
      .where({ id })
      .first();
    expect(media?.techMetadata).toMatchObject({
      analysisStages: {
        ocr: { status: "completed" },
        transcription: { status: "silent" },
      },
      codec: "mp3",
      duration: 20,
      semanticClassificationVersion: "test-v1",
    });
    const coverage = await getMediaAnalysisCoverage();
    expect(coverage[0]?.pending).toBeGreaterThanOrEqual(1);
    expect(coverage[0]?.ready).toBeGreaterThanOrEqual(
      coverage[0]?.pending ?? 0
    );
    expect(Array.isArray(await getPlaybackMetrics())).toBe(true);
  } finally {
    await prisma.orm.public.PostMedia.where({ id }).deleteAndCount();
    await prisma.orm.public.Users.where({ id }).deleteAndCount();
    expect(await prisma.orm.public.PostMedia.where({ id }).first()).toBeNull();
  }
}, 30_000);
