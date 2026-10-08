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

import type { Contract as Start } from "../../snapshots/06f2519dd379ed7ab7b8e51af6808af4a5d6164aed837f60acfd9a1187cbf341/contract";
import startContract from "../../snapshots/06f2519dd379ed7ab7b8e51af6808af4a5d6164aed837f60acfd9a1187cbf341/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/f7eb93c18a70aa807d4208d770024fa4c5c393e51aaed51094cb38b6c2c7dfee/contract";
import endContract from "../../snapshots/f7eb93c18a70aa807d4208d770024fa4c5c393e51aaed51094cb38b6c2c7dfee/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.createTable({
        schema: "public",
        table: "message_search_account_state",
        columns: [
          col("recoveryGeneration", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("updatedAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
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
          primaryKey(["userId"], { name: "message_search_account_state_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_search_coverage",
        columns: [
          col("artifactsCommitted", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("completedChangeSeq", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("conversationId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("recoveryGeneration", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("rowsTraversed", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("unrecoverableEpochs", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("updatedAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
        ],
        constraints: [
          primaryKey(["conversationId"], {
            name: "message_search_coverage_pkey",
          }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_search_documents",
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
          col("messageId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("revision", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("termIds", "int4[]", {
            notNull: true,
            default: lit([]),
            codecRef: { codecId: "pg/int4@1", many: true },
          }),
        ],
        constraints: [
          primaryKey(["messageId"], { name: "message_search_documents_pkey" }),
          checkExpression(
            "message_search_documents_termIds_elem_not_null_c60d8cf2",
            'array_position("termIds", NULL) IS NULL'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_search_outbox",
        columns: [
          col("attempts", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("audienceUserIds", "text[]", {
            notNull: true,
            default: lit([]),
            codecRef: { codecId: "pg/text@1", many: true },
          }),
          col("changeSequence", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("completedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
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
          col("messageId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("revision", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_search_outbox_pkey" }),
          checkExpression(
            "message_search_outbox_audienceUserIds_elem_not_null_5d6452e6",
            'array_position("audienceUserIds", NULL) IS NULL'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_search_terms",
        columns: [
          col("conversationId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("gramKeys", "text[]", {
            notNull: true,
            codecRef: { codecId: "pg/text@1", many: true },
          }),
          col("id", "SERIAL", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("normalized", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_search_terms_pkey" }),
          checkExpression(
            "message_search_terms_gramKeys_elem_not_null_3012be25",
            'array_position("gramKeys", NULL) IS NULL'
          ),
        ],
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("changeSeq", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "messages",
        column: col("creationSequence", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "messages",
        column: col("keyEpoch", "int4", { codecRef: { codecId: "pg/int4@1" } }),
      }),
      this.addColumn({
        schema: "public",
        table: "messages",
        column: col("revision", "int4", {
          notNull: true,
          default: lit(1),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addUnique({
        schema: "public",
        table: "message_search_terms",
        constraint: "message_search_terms_conversation_normalized_key",
        columns: ["conversationId", "normalized"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_documents",
        index: "message_search_documents_conversation_created_message_idx",
        columns: ["conversationId", "createdAt", "messageId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_documents",
        index: "message_search_documents_term_ids_idx",
        columns: ["termIds"],
        extras: { type: "gin" },
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_outbox",
        index: "message_search_outbox_conversation_sequence_idx",
        columns: ["conversationId", "changeSequence"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_outbox",
        index: "message_search_outbox_pending_created_idx",
        columns: ["completedAt", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_terms",
        index: "message_search_terms_conversation_id_idx",
        columns: ["conversationId", "id"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_terms",
        index: "message_search_terms_gram_keys_idx",
        columns: ["gramKeys"],
        extras: { type: "gin" },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
