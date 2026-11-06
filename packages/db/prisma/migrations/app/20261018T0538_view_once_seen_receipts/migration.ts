#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  primaryKey,
} from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/b1af30e149c6818b87f997ed352168521625b3a5a35058c6873af99b9c36d300/contract";
import startContract from "../../snapshots/b1af30e149c6818b87f997ed352168521625b3a5a35058c6873af99b9c36d300/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/c912811348f2374ffcf924266789c07cec2f94bae6493f89a4349368986210d8/contract";
import endContract from "../../snapshots/c912811348f2374ffcf924266789c07cec2f94bae6493f89a4349368986210d8/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: "public",
        table: "message_view_once_receipts",
        columns: [
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("incognitoMessageId", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("mediaId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("messageId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("openedAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("seenAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_view_once_receipts_pkey" }),
          checkExpression(
            "view_once_receipts_exact_source_cdff524f",
            '("messageId" IS NULL) <> ("incognitoMessageId" IS NULL)'
          ),
        ],
      }),
      this.addUnique({
        schema: "public",
        table: "message_view_once_receipts",
        constraint: "view_once_receipts_media_user_key",
        columns: ["mediaId", "userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_view_once_receipts",
        index: "view_once_receipts_incognito_idx",
        columns: ["incognitoMessageId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_view_once_receipts",
        index: "view_once_receipts_message_idx",
        columns: ["messageId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_view_once_receipts",
        index: "view_once_receipts_user_idx",
        columns: ["userId"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_view_once_receipts",
        foreignKey: {
          name: "view_once_receipts_message_fkey",
          columns: ["messageId"],
          references: { schema: "public", table: "messages", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_view_once_receipts",
        foreignKey: {
          name: "view_once_receipts_incognito_fkey",
          columns: ["incognitoMessageId"],
          references: {
            schema: "public",
            table: "message_incognito_messages",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_view_once_receipts",
        foreignKey: {
          name: "view_once_receipts_user_fkey",
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
