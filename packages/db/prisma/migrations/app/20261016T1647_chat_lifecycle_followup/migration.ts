#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  lit,
} from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/76f73e9aed637b2c3cf996b7a2caeed3a12268b684129d0402575e2f1c753eba/contract";
import endContract from "../../snapshots/76f73e9aed637b2c3cf996b7a2caeed3a12268b684129d0402575e2f1c753eba/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/dc588b5862316269a4cadce0b8f36ac75b36a0ff6c0b602803658def6f509b33/contract";
import startContract from "../../snapshots/dc588b5862316269a4cadce0b8f36ac75b36a0ff6c0b602803658def6f509b33/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: "public",
        table: "message_export_jobs",
        column: col("artifactKey", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_export_jobs",
        column: col("fromDate", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_export_jobs",
        column: col("membershipSequence", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_export_jobs",
        column: col("toDate", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_incognito_sessions",
        column: col("purgedAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "post_media",
        column: col("incognitoSessionId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.createIndex({
        schema: "public",
        table: "message_incognito_sessions",
        index: "incognito_purge_due_618ec377",
        columns: ["endedAt", "id"],
        extras: { where: '("endedAt" IS NOT NULL AND "purgedAt" IS NULL)' },
      }),
      this.createIndex({
        schema: "public",
        table: "messages",
        index: "messages_lifecycle_erasure_due_7f300049",
        columns: ["expiresAt", "id"],
        extras: { where: "(\"expiresAt\" IS NOT NULL AND ciphertext <> '')" },
      }),
      this.createIndex({
        schema: "public",
        table: "post_media",
        index: "media_lifecycle_erasure_due_d202ba84",
        columns: ["id"],
        extras: { where: "(\"failureCode\" = 'CHAT_LIFECYCLE_ERASURE')" },
      }),
      this.createIndex({
        schema: "public",
        table: "post_media",
        index: "post_media_incognitoSessionId_idx_e9d021b8",
        columns: ["incognitoSessionId"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "post_media",
        foreignKey: {
          name: "post_media_incognitoSessionId_fkey",
          columns: ["incognitoSessionId"],
          references: {
            schema: "public",
            table: "message_incognito_sessions",
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
