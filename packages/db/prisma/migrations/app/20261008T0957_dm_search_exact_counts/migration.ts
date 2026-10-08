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

import type { Contract as End } from "../../snapshots/10f1db84b1d6dcc97be0ba26b4414398b53f7cbf64c87be87f919ea141ed483b/contract";
import endContract from "../../snapshots/10f1db84b1d6dcc97be0ba26b4414398b53f7cbf64c87be87f919ea141ed483b/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/d37e932a95328c82ad6b5cfcc889bbe903103611b89fb01c1405361fa68a7e33/contract";
import startContract from "../../snapshots/d37e932a95328c82ad6b5cfcc889bbe903103611b89fb01c1405361fa68a7e33/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.createTable({
        schema: "public",
        table: "message_search_count_requests",
        columns: [
          col("attempts", "int4", {
            notNull: true,
            default: lit(0),
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
          col("exactCount", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("expiresAt", "timestamp(3)", {
            notNull: true,
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("fragments", "jsonb", { codecRef: { codecId: "pg/jsonb@1" } }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("leaseUntil", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("membershipSequence", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("membershipWindows", "jsonb", {
            codecRef: { codecId: "pg/jsonb@1" },
          }),
          col("normalizationVersion", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("queryHash", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("recoveryGeneration", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("requestKey", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("snapshotSequence", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("state", "text", {
            notNull: true,
            default: lit("pending"),
            codecRef: { codecId: "pg/text@1" },
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
          primaryKey(["id"], { name: "message_search_count_requests_pkey" }),
        ],
      }),
      this.addUnique({
        schema: "public",
        table: "message_search_count_requests",
        constraint: "message_search_count_requests_request_key_key",
        columns: ["requestKey"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_count_requests",
        index: "message_search_count_requests_expires_idx",
        columns: ["expiresAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_count_requests",
        index: "message_search_count_requests_scope_created_idx",
        columns: ["userId", "conversationId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_count_requests",
        index: "message_search_count_requests_state_created_idx",
        columns: ["state", "createdAt"],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
