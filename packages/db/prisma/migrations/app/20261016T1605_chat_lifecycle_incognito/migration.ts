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

import type { Contract as Start } from "../../snapshots/138af29975c9707748b1aaa401859a1a8c3fd7bfb5ce447ff70199f1193156c0/contract";
import startContract from "../../snapshots/138af29975c9707748b1aaa401859a1a8c3fd7bfb5ce447ff70199f1193156c0/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/dc588b5862316269a4cadce0b8f36ac75b36a0ff6c0b602803658def6f509b33/contract";
import endContract from "../../snapshots/dc588b5862316269a4cadce0b8f36ac75b36a0ff6c0b602803658def6f509b33/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): Migration<Start, End>["operations"] {
    return [
      this.createTable({
        schema: "public",
        table: "message_export_jobs",
        columns: [
          col("clearedThroughSequence", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
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
          col("errorCode", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("expiresAt", "timestamp(3)", {
            notNull: true,
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("includeMedia", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("leaseUntil", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("objectKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("recoveryGeneration", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("snapshotSequence", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("status", "text", {
            notNull: true,
            default: lit("pending"),
            codecRef: { codecId: "pg/text@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"])],
      }),
      this.createTable({
        schema: "public",
        table: "message_incognito_messages",
        columns: [
          col("ciphertext", "text", {
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
          col("iv", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("keyEpoch", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("ratchetIndex", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("senderId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("sequence", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("sessionId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"])],
      }),
      this.createTable({
        schema: "public",
        table: "message_incognito_sessions",
        columns: [
          col("conversationId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("endReason", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("endedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("endedById", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("endedByName", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("expiresAt", "timestamp(3)", {
            notNull: true,
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("nextSequence", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("startedAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("startedById", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("startedByName", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"])],
      }),
      this.createTable({
        schema: "public",
        table: "message_media_links",
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
        ],
        constraints: [
          primaryKey(["id"]),
          checkExpression(
            "message_media_exact_source_cdff524f",
            '("messageId" IS NULL) <> ("incognitoMessageId" IS NULL)'
          ),
        ],
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("clearedAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("clearedThroughSequence", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("inboxHiddenAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("retentionSeconds", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("retentionVersion", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "messages",
        column: col("expiresAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "post_media",
        column: col("messageLifecycleProtected", "bool", {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: "pg/bool@1" },
        }),
      }),
      this.addUnique({
        schema: "public",
        table: "message_incognito_messages",
        constraint: "message_incognito_messages_sessionId_sequence_key",
        columns: ["sessionId", "sequence"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_incognito_messages",
        constraint: "incognito_message_sender_ratchet",
        columns: ["sessionId", "senderId", "ratchetIndex"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_media_links",
        constraint: "message_media_links_messageId_mediaId_key",
        columns: ["messageId", "mediaId"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_media_links",
        constraint: "message_media_incognito_unique",
        columns: ["incognitoMessageId", "mediaId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_export_jobs",
        index: "message_export_jobs_conversationId_idx_669215a6",
        columns: ["conversationId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_export_jobs",
        index: "message_export_jobs_expiresAt_idx_6b6b8c10",
        columns: ["expiresAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_export_jobs",
        index: "message_export_jobs_status_createdAt_idx_58610442",
        columns: ["status", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_export_jobs",
        index: "message_export_jobs_userId_idx_a489d58a",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_export_jobs",
        index: "message_export_user_conversation_e3757d35",
        columns: ["userId", "conversationId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_incognito_messages",
        index: "message_incognito_messages_senderId_idx_4689c490",
        columns: ["senderId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_incognito_sessions",
        index: "incognito_conversation_started_3327d598",
        columns: ["conversationId", "startedAt", "id"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_incognito_sessions",
        index: "message_incognito_due_be6e1003",
        columns: ["expiresAt"],
        extras: { where: '("endedAt" IS NULL)' },
      }),
      this.createIndex({
        schema: "public",
        table: "message_incognito_sessions",
        index: "message_incognito_one_active_556b95fb",
        columns: ["conversationId"],
        extras: { where: '("endedAt" IS NULL)', unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "message_incognito_sessions",
        index: "message_incognito_sessions_endedById_idx_4049a1b9",
        columns: ["endedById"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_incognito_sessions",
        index: "message_incognito_sessions_startedById_idx_a8358300",
        columns: ["startedById"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_media_links",
        index: "message_media_links_incognitoMessageId_idx_6efaf95e",
        columns: ["incognitoMessageId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_media_links",
        index: "message_media_links_mediaId_idx_6b06655c",
        columns: ["mediaId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_media_links",
        index: "message_media_links_messageId_idx_3cdded8d",
        columns: ["messageId"],
      }),
      this.createIndex({
        schema: "public",
        table: "messages",
        index: "messages_expiry_due_idx_a83a16eb",
        columns: ["expiresAt", "id"],
        extras: { where: '("expiresAt" IS NOT NULL AND "deletedAt" IS NULL)' },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_export_jobs",
        foreignKey: {
          name: "message_export_jobs_conversationId_fkey",
          columns: ["conversationId"],
          references: {
            schema: "public",
            table: "message_conversations",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_export_jobs",
        foreignKey: {
          name: "message_export_jobs_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_incognito_messages",
        foreignKey: {
          name: "message_incognito_messages_sessionId_fkey",
          columns: ["sessionId"],
          references: {
            schema: "public",
            table: "message_incognito_sessions",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_incognito_messages",
        foreignKey: {
          name: "message_incognito_messages_senderId_fkey",
          columns: ["senderId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_incognito_sessions",
        foreignKey: {
          name: "message_incognito_sessions_conversationId_fkey",
          columns: ["conversationId"],
          references: {
            schema: "public",
            table: "message_conversations",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_incognito_sessions",
        foreignKey: {
          name: "message_incognito_sessions_startedById_fkey",
          columns: ["startedById"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_incognito_sessions",
        foreignKey: {
          name: "message_incognito_sessions_endedById_fkey",
          columns: ["endedById"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_media_links",
        foreignKey: {
          name: "message_media_links_messageId_fkey",
          columns: ["messageId"],
          references: { schema: "public", table: "messages", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_media_links",
        foreignKey: {
          name: "message_media_links_incognitoMessageId_fkey",
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
        table: "message_media_links",
        foreignKey: {
          name: "message_media_links_mediaId_fkey",
          columns: ["mediaId"],
          references: {
            schema: "public",
            table: "post_media",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
