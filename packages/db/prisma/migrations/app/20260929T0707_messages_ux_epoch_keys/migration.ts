#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
} from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/55385198205e5385016cb220c36901098fb22f12cdcf911754fd072a104ab362/contract";
import startContract from "../../snapshots/55385198205e5385016cb220c36901098fb22f12cdcf911754fd072a104ab362/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/b710be6a3e5e6e7f6accdce53c224fd887cd0be330a69146799ef246c4f79df9/contract";
import endContract from "../../snapshots/b710be6a3e5e6e7f6accdce53c224fd887cd0be330a69146799ef246c4f79df9/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.dropConstraint({
        schema: "public",
        table: "message_conversation_keys",
        constraint: "message_conversation_keys_conversationId_ownerUserId_key",
      }),
      this.createTable({
        schema: "public",
        table: "message_hidden",
        columns: [
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("messageId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["messageId", "userId"], { name: "message_hidden_pkey" }),
        ],
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_keys",
        column: col("version", "int4", {
          notNull: true,
          default: lit(1),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("lastDeliveredAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("mutedAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("themeKey", "text", { codecRef: { codecId: "pg/text@1" } }),
      }),
      this.addColumn({
        schema: "public",
        table: "messages",
        column: col("editedAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addUnique({
        schema: "public",
        table: "message_conversation_keys",
        constraint:
          "message_conversation_keys_conversationId_ownerUserId_versio_key",
        columns: ["conversationId", "ownerUserId", "version"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_keys",
        index: "message_conversation_keys_conversationId_ownerUserId_idx",
        columns: ["conversationId", "ownerUserId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_members",
        index: "message_conversation_members_userId_mutedAt_idx",
        columns: ["userId", "mutedAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_hidden",
        index: "message_hidden_userId_idx",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "messages",
        index: "messages_conversationId_id_idx",
        columns: ["conversationId", "id"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_hidden",
        foreignKey: {
          name: "message_hidden_messageId_fkey",
          columns: ["messageId"],
          references: { schema: "public", table: "messages", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_hidden",
        foreignKey: {
          name: "message_hidden_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
