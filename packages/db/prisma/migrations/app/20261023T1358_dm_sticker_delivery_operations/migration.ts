#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/4e644a055f8f94aa959538683b9b34a08a4afe13f6961c085b5be8e417362dc9/contract";
import endContract from "../../snapshots/4e644a055f8f94aa959538683b9b34a08a4afe13f6961c085b5be8e417362dc9/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/db55bebbf5d57bf32caa0b439698bddc2d2f0a646c8e49c2359b1b594eb0a65e/contract";
import startContract from "../../snapshots/db55bebbf5d57bf32caa0b439698bddc2d2f0a646c8e49c2359b1b594eb0a65e/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: "public",
        table: "post_media",
        column: col("stickerOperationId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addUnique({
        schema: "public",
        table: "post_media",
        constraint: "post_media_userId_stickerOperationId_key",
        columns: ["userId", "stickerOperationId"],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
