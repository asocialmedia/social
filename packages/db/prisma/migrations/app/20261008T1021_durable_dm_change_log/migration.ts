#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/3dbc6de73b371fc0bc4da178d5c88889b2b9019bed61a493bb9b610000551e14/contract";
import endContract from "../../snapshots/3dbc6de73b371fc0bc4da178d5c88889b2b9019bed61a493bb9b610000551e14/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/10f1db84b1d6dcc97be0ba26b4414398b53f7cbf64c87be87f919ea141ed483b/contract";
import startContract from "../../snapshots/10f1db84b1d6dcc97be0ba26b4414398b53f7cbf64c87be87f919ea141ed483b/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.createTable({
        schema: "public",
        table: "message_conversation_changes",
        columns: [
          col("audienceUserIds", "text[]", {
            notNull: true,
            default: lit([]),
            codecRef: { codecId: "pg/text@1", many: true },
          }),
          col("conversationId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("kind", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("messageId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("revision", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("sequence", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_conversation_changes_pkey" }),
          checkExpression(
            "message_conversation_changes_audienceUserIds_elem_not__5d6452e6",
            'array_position("audienceUserIds", NULL) IS NULL'
          ),
        ],
      }),
      this.addUnique({
        schema: "public",
        table: "message_conversation_changes",
        constraint: "message_conversation_changes_conversation_sequence_key",
        columns: ["conversationId", "sequence"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_changes",
        index: "message_conversation_changes_conversation_created_idx",
        columns: ["conversationId", "createdAt"],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
