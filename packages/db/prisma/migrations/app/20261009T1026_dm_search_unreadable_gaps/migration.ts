#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  lit,
  primaryKey,
} from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/660d8ca10a17b595cf52d9da8abe8c1b81543dbeafba3d067665dca834061a8b/contract";
import endContract from "../../snapshots/660d8ca10a17b595cf52d9da8abe8c1b81543dbeafba3d067665dca834061a8b/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/a50a7555eb8b3c15d8150f64247d6bccf10c6ad5b693d7f87a35eb8cc203a80e/contract";
import startContract from "../../snapshots/a50a7555eb8b3c15d8150f64247d6bccf10c6ad5b693d7f87a35eb8cc203a80e/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.createTable({
        schema: "public",
        table: "message_search_gaps",
        columns: [
          col("conversationId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("keyEpoch", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("messageId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("revision", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("unrecoverableEpoch", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
        ],
        constraints: [
          primaryKey(["conversationId", "messageId"], {
            name: "message_search_gaps_pkey",
          }),
        ],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_gaps",
        index: "message_search_gaps_epoch_idx",
        columns: ["conversationId", "keyEpoch"],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
