#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/d37e932a95328c82ad6b5cfcc889bbe903103611b89fb01c1405361fa68a7e33/contract";
import endContract from "../../snapshots/d37e932a95328c82ad6b5cfcc889bbe903103611b89fb01c1405361fa68a7e33/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/f7eb93c18a70aa807d4208d770024fa4c5c393e51aaed51094cb38b6c2c7dfee/contract";
import startContract from "../../snapshots/f7eb93c18a70aa807d4208d770024fa4c5c393e51aaed51094cb38b6c2c7dfee/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.addColumn({
        schema: "public",
        table: "message_search_coverage",
        column: col("backfillCompletedAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_search_coverage",
        column: col("backfillCursorCreatedAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_search_coverage",
        column: col("backfillCursorMessageId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_search_coverage",
        column: col("backfillStartedAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_search_coverage",
        column: col("backfillThroughSequence", "int4", {
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_coverage",
        index: "message_search_coverage_backfill_idx",
        columns: ["backfillCompletedAt", "backfillStartedAt"],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
