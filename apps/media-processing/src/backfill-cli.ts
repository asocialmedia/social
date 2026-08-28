// One-shot backfill CLI: converts legacy media rows into the pipeline.
// Usage: bun run src/backfill-cli.ts [--limit N] [--gc] [--dry-run]
//
// Prod rollout order: dry-run first to inspect volume and historical MIME
// drift, then bounded runs (--limit), then let the daily sweep finish the
// tail. --gc requires MEDIA_LEGACY_GC_ENABLED=1 or the explicit flag below;
// the scheduled sweep can never delete objects without the env opt-in.

import { loadRootEnv } from "./load-env";

if (import.meta.main) {
  loadRootEnv();
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const withGc = args.has("--gc");
  // Explicit --gc on the CLI is deliberate operator consent; the scheduled
  // sweep remains gated purely by MEDIA_LEGACY_GC_ENABLED.
  if (withGc) {
    process.env.MEDIA_LEGACY_GC_ENABLED = "1";
  }
  const { backfillSweep, legacyGcSweep } = await import("./backfill");

  const limitIndex = process.argv.indexOf("--limit");
  if (limitIndex !== -1) {
    const parsed = Number(process.argv[limitIndex + 1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      process.env.MEDIA_BACKFILL_BATCH = String(Math.floor(parsed));
    }
  }

  if (dryRun) {
    // Report what would be converted without mutating anything, including
    // the declared-MIME breakdown so historical type drift is visible
    // before any row enters the scan stage.
    const { prisma } = await import("@asm/db");
    const candidateWhere = {
      key: { not: "" },
      pipelineVersion: null,
      status: "UPLOADING",
      url: { not: "" },
    } as const;
    const pending = await prisma.media.count({ where: candidateWhere });
    console.log(
      `Dry run: ${pending} legacy media rows would be enqueued for conversion.`
    );
    const byMime = await prisma.media.groupBy({
      _count: { _all: true },
      by: ["mimeType"],
      where: candidateWhere,
    });
    for (const entry of byMime) {
      console.log(
        `  ${(entry.mimeType || "<empty>").padEnd(28)} ${entry._count._all}`
      );
    }
    console.log(
      "Rows with empty/odd MIME values above are tolerated by the scan stage (content detection wins); undetectable bytes are still rejected."
    );
    process.exit(0);
  }

  const result = await backfillSweep();
  console.log(`Backfill enqueued ${result.enqueued} media rows.`);
  if (withGc) {
    const gc = await legacyGcSweep();
    console.log(`Legacy GC removed ${gc.deletedObjects} superseded objects.`);
  }
  const { getTelemetryApi } = await import("@asm/logger");
  void getTelemetryApi;
  process.exit(0);
}
