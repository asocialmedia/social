// One-shot backfill CLI: converts legacy media rows into the pipeline.
// Usage: bun run src/backfill-cli.ts [--limit N] [--gc] [--dry-run]

import { loadRootEnv } from "./load-env";

if (import.meta.main) {
  loadRootEnv();
  const { backfillSweep, legacyGcSweep } = await import("./backfill");

  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const withGc = args.has("--gc");
  const limitIndex = process.argv.indexOf("--limit");
  if (limitIndex !== -1) {
    const parsed = Number(process.argv[limitIndex + 1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      process.env.MEDIA_BACKFILL_BATCH = String(Math.floor(parsed));
    }
  }

  if (dryRun) {
    // Report what would be converted without mutating anything.
    const { prisma } = await import("@asm/db");
    const pending = await prisma.media.count({
      where: {
        key: { not: "" },
        pipelineVersion: null,
        status: "UPLOADING",
        url: { not: "" },
      },
    });
    console.log(
      `Dry run: ${pending} legacy media rows would be enqueued for conversion.`
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
