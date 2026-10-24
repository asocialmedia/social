#!/usr/bin/env -S node
import { Migration, MigrationCLI, col } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/1b7aa6731e6317642df582a77c348cacbdc6b0dc385ae14a5322115db5fdd7ba/contract";
import endContract from "../../snapshots/1b7aa6731e6317642df582a77c348cacbdc6b0dc385ae14a5322115db5fdd7ba/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/ce7d276079293d76321047ab02e8131e5639b24613afbd372a2af1d4d31c9bce/contract";
import startContract from "../../snapshots/ce7d276079293d76321047ab02e8131e5639b24613afbd372a2af1d4d31c9bce/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: "public",
        table: "posts",
        column: col("externalParentId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.createIndex({
        schema: "public",
        table: "posts",
        index: "posts_externalParentId_idx_23c1048b",
        columns: ["externalParentId"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "posts",
        foreignKey: {
          name: "posts_externalParentId_fkey",
          columns: ["externalParentId"],
          references: {
            schema: "public",
            table: "external_posts",
            columns: ["id"],
          },
          onDelete: "setNull",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
