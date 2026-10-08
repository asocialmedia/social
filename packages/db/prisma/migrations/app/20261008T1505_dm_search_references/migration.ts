#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  primaryKey,
} from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/150a9099f36a19ccce05220ad8498cbebc638383cea233f8395c4c67905f8d9a/contract";
import startContract from "../../snapshots/150a9099f36a19ccce05220ad8498cbebc638383cea233f8395c4c67905f8d9a/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/be310df7fdd814138a2372ff4b36eef8fb63bb78d55fbdc79ac82d404e6546b2/contract";
import endContract from "../../snapshots/be310df7fdd814138a2372ff4b36eef8fb63bb78d55fbdc79ac82d404e6546b2/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.createTable({
        schema: "public",
        table: "message_search_references",
        columns: [
          col("conversationId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("createdAt", "timestamp(3)", {
            notNull: true,
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("kind", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("mediaKind", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("messageId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("ordinal", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("requiredId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("revision", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
        ],
        constraints: [
          primaryKey(["messageId", "kind", "ordinal"], {
            name: "message_search_references_pkey",
          }),
        ],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_references",
        index: "message_search_references_conversation_kind_created_idx",
        columns: [
          "conversationId",
          "kind",
          "createdAt",
          "messageId",
          "ordinal",
        ],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
