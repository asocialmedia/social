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

import type { Contract as End } from "../../snapshots/bf4815582bf4e8ac4b2d3103c4505c4e19375badb772694a8a29e08524b762c1/contract";
import endContract from "../../snapshots/bf4815582bf4e8ac4b2d3103c4505c4e19375badb772694a8a29e08524b762c1/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/e1eff0c9dde5791726b035488e6edae24d971f7632ab8f5416069d414cbb5a23/contract";
import startContract from "../../snapshots/e1eff0c9dde5791726b035488e6edae24d971f7632ab8f5416069d414cbb5a23/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createNativeEnumType({
        schema: "public",
        typeName: "ViewOnceGrantStatus",
        members: ["RESERVED", "ACTIVE", "CLOSED", "EXPIRED", "REVOKED"],
      }),
      this.createTable({
        schema: "public",
        table: "message_reaction_counts",
        columns: [
          col("count", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("emoji", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("incognitoMessageId", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("messageId", "text", { codecRef: { codecId: "pg/text@1" } }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_reaction_counts_pkey" }),
          checkExpression(
            "message_reaction_counts_emoji_length_646c7d08",
            'char_length("emoji") BETWEEN 1 AND 32'
          ),
          checkExpression(
            "message_reaction_counts_exact_source_cdff524f",
            '("messageId" IS NULL) <> ("incognitoMessageId" IS NULL)'
          ),
          checkExpression(
            "message_reaction_counts_positive_4bde5bb6",
            '"count" >= 1'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_reactions",
        columns: [
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("emoji", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("incognitoMessageId", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("messageId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_reactions_pkey" }),
          checkExpression(
            "message_reactions_emoji_length_646c7d08",
            'char_length("emoji") BETWEEN 1 AND 32'
          ),
          checkExpression(
            "message_reactions_exact_source_cdff524f",
            '("messageId" IS NULL) <> ("incognitoMessageId" IS NULL)'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_view_once_grants",
        columns: [
          col("activatedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("closedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("expiresAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("recipientId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("reservedAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("status", '"ViewOnceGrantStatus"', {
            notNull: true,
            default: lit("RESERVED"),
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "ViewOnceGrantStatus" },
            },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_view_once_grants_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_view_once_recipients",
        columns: [
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
          col("mediaLinkId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_view_once_recipients_pkey" }),
        ],
      }),
      this.addColumn({
        schema: "public",
        table: "message_media_links",
        column: col("deliveryExpiresAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_media_links",
        column: col("viewOnce", "bool", {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: "pg/bool@1" },
        }),
      }),
      this.addUnique({
        schema: "public",
        table: "message_reaction_counts",
        constraint: "message_reaction_counts_incognito_emoji_unique",
        columns: ["incognitoMessageId", "emoji"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_reaction_counts",
        constraint: "message_reaction_counts_message_emoji_unique",
        columns: ["messageId", "emoji"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_reactions",
        constraint: "message_reactions_incognito_user_unique",
        columns: ["incognitoMessageId", "userId"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_reactions",
        constraint: "message_reactions_message_user_unique",
        columns: ["messageId", "userId"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_view_once_recipients",
        constraint: "message_view_once_recipients_media_user_unique",
        columns: ["mediaLinkId", "userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_media_links",
        index: "message_media_viewonce_due_a36050d7",
        columns: ["deliveryExpiresAt", "id"],
        extras: { where: '("viewOnce" AND "deliveryExpiresAt" IS NOT NULL)' },
      }),
      this.createIndex({
        schema: "public",
        table: "message_reactions",
        index: "message_reactions_incognito_emoji_idx",
        columns: ["incognitoMessageId", "emoji"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_reactions",
        index: "message_reactions_message_emoji_idx",
        columns: ["messageId", "emoji"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_reactions",
        index: "message_reactions_userId_idx",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_view_once_grants",
        index: "message_view_once_grants_live_unique_1915abed",
        columns: ["recipientId"],
        extras: {
          where: "(\"status\" IN ('RESERVED', 'ACTIVE'))",
          unique: true,
        },
      }),
      this.createIndex({
        schema: "public",
        table: "message_view_once_grants",
        index: "message_view_once_grants_status_expiry_idx",
        columns: ["status", "expiresAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_view_once_recipients",
        index: "message_view_once_recipients_userId_idx",
        columns: ["userId"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_reaction_counts",
        foreignKey: {
          name: "message_reaction_counts_messageId_fkey",
          columns: ["messageId"],
          references: { schema: "public", table: "messages", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_reaction_counts",
        foreignKey: {
          name: "message_reaction_counts_incognitoMessageId_fkey",
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
        table: "message_reactions",
        foreignKey: {
          name: "message_reactions_messageId_fkey",
          columns: ["messageId"],
          references: { schema: "public", table: "messages", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_reactions",
        foreignKey: {
          name: "message_reactions_incognitoMessageId_fkey",
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
        table: "message_reactions",
        foreignKey: {
          name: "message_reactions_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_view_once_grants",
        foreignKey: {
          name: "message_view_once_grants_recipientId_fkey",
          columns: ["recipientId"],
          references: {
            schema: "public",
            table: "message_view_once_recipients",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_view_once_recipients",
        foreignKey: {
          name: "message_view_once_recipients_mediaLinkId_fkey",
          columns: ["mediaLinkId"],
          references: {
            schema: "public",
            table: "message_media_links",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_view_once_recipients",
        foreignKey: {
          name: "message_view_once_recipients_userId_fkey",
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
