#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/9d7dbf1767c9a7a36face45df28d359f59eb2283de2cdab57878ca06192718d4/contract";
import endContract from "../../snapshots/9d7dbf1767c9a7a36face45df28d359f59eb2283de2cdab57878ca06192718d4/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/9f6bcefbc32409039f07ecb2fb4e880ee5a0539b60cdd817b209f8feb24750ff/contract";
import startContract from "../../snapshots/9f6bcefbc32409039f07ecb2fb4e880ee5a0539b60cdd817b209f8feb24750ff/contract.json" with { type: "json" };

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
