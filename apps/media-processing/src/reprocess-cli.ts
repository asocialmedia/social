// Re-run derivative generation for existing READY media. Use when the
// pipeline/encoder version bumps (e.g. v1 → v2) so old posts pick up the
// new quality/policy without waiting for new uploads.
//
// Usage: bun run src/reprocess-cli.ts [--kind image|video|audio]
//                                   [--mediaId <id>] [--limit N] [--dry-run]
//
// By default it targets every READY row whose pipelineVersion trails the
// code's MEDIA_PIPELINE_VERSION; pass --all to ignore the version check.
// Each match has its derivative rows + objects removed and a process job
// re-enqueued purely from the stored publishedKey (no source re-upload).

import { loadRootEnv } from "./load-env";

if (import.meta.main) {
  loadRootEnv();

  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const includeCurrent = args.has("--all");
  const kindIndex = process.argv.indexOf("--kind");
  const mediaIdIndex = process.argv.indexOf("--mediaId");
  const limitIndex = process.argv.indexOf("--limit");

  let targetKind: string | undefined;
  if (kindIndex !== -1) {
    const raw = process.argv[kindIndex + 1]?.toLowerCase();
    if (raw && ["image", "video", "audio"].includes(raw)) {
      targetKind = raw.toUpperCase();
    } else {
      console.error("--kind must be one of: image, video, audio");
      process.exit(1);
    }
  }

  const targetMediaId =
    mediaIdIndex === -1 ? undefined : process.argv[mediaIdIndex + 1];

  let limit = 200;
  if (limitIndex !== -1) {
    const parsed = Number(process.argv[limitIndex + 1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.floor(parsed);
    }
  }

  const { prisma } = await import("@asm/db");
  const { MEDIA_PIPELINE_VERSION } = await import("@asm/media");
  const { enqueueMediaProcess } = await import("@asm/db");

  const where: Record<string, unknown> = targetMediaId
    ? { id: targetMediaId, publishedKey: { not: null }, status: "READY" }
    : {
        publishedKey: { not: null },
        status: "READY",
        ...(targetKind ? { type: targetKind as unknown as string } : {}),
        ...(includeCurrent
          ? {}
          : { pipelineVersion: { not: MEDIA_PIPELINE_VERSION } }),
      };

  if (dryRun) {
    const count = await prisma.media.count({ where });
    const byType = await prisma.media.groupBy({
      _count: { _all: true },
      by: ["type"],
      where,
    });
    console.log(
      `Dry run: ${count} media rows would be reprocessed (v=${MEDIA_PIPELINE_VERSION}, limit ${limit}).`
    );
    for (const entry of byType) {
      console.log(`  ${String(entry.type).padEnd(12)} ${entry._count._all}`);
    }
    process.exit(0);
  }

  const rows = await prisma.media.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, pipelineVersion: true, type: true },
    take: limit,
    where,
  });

  if (rows.length === 0) {
    console.log("Nothing to reprocess.");
    process.exit(0);
  }

  const { getS3 } = await import("./s3");
  const s3 = getS3();

  let requeued = 0;
  for (const row of rows) {
    const derivatives = await prisma.mediaDerivative.findMany({
      select: { key: true },
      where: { mediaId: row.id },
    });
    await Promise.allSettled(derivatives.map((d) => s3.delete(d.key)));
    await prisma.mediaDerivative.deleteMany({ where: { mediaId: row.id } });
    await enqueueMediaProcess(row.id);
    requeued += 1;
    console.log(
      `  ${row.type} ${row.id} (was v${row.pipelineVersion}) → requeued`
    );
  }
  console.log(
    `Reprocess: ${requeued} rows requeued; process jobs will regenerate derivatives.`
  );
  process.exit(0);
}
