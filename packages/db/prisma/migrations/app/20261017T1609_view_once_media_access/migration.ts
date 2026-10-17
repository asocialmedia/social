#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  lit,
} from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/7a921010aec50c8a98e3c36905fd98019f89d160847676b8fbcaac9b3efe522b/contract";
import endContract from "../../snapshots/7a921010aec50c8a98e3c36905fd98019f89d160847676b8fbcaac9b3efe522b/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/bf4815582bf4e8ac4b2d3103c4505c4e19375badb772694a8a29e08524b762c1/contract";
import startContract from "../../snapshots/bf4815582bf4e8ac4b2d3103c4505c4e19375badb772694a8a29e08524b762c1/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: "public",
        table: "post_media",
        column: col("messageViewOnce", "bool", {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: "pg/bool@1" },
        }),
      }),
      this.createIndex({
        schema: "public",
        table: "message_media_links",
        index: "message_media_viewonce_media_unique_ff0d1126",
        columns: ["mediaId"],
        extras: { where: '("viewOnce")', unique: true },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
