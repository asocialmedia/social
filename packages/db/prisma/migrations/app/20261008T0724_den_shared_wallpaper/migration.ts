#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/06f2519dd379ed7ab7b8e51af6808af4a5d6164aed837f60acfd9a1187cbf341/contract";
import endContract from "../../snapshots/06f2519dd379ed7ab7b8e51af6808af4a5d6164aed837f60acfd9a1187cbf341/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/7d283b55a58348a6e9bd0c560aaa228e7c672b2024a8a1046fabba45d82e13e6/contract";
import startContract from "../../snapshots/7d283b55a58348a6e9bd0c560aaa228e7c672b2024a8a1046fabba45d82e13e6/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("wallpaperDim", "int4", {
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("wallpaperKey", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("wallpaperMediaId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversations",
        index: "message_conversations_wallpaperMediaId_idx_e7014658",
        columns: ["wallpaperMediaId"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_conversations",
        foreignKey: {
          name: "message_conversations_wallpaperMediaId_fkey",
          columns: ["wallpaperMediaId"],
          references: {
            schema: "public",
            table: "post_media",
            columns: ["id"],
          },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
