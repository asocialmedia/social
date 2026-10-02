#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  primaryKey,
} from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/20e4834e60e525681c5d493d17c83d2c6aeab54d2c2c9b4d48c3018634554e38/contract";
import startContract from "../../snapshots/20e4834e60e525681c5d493d17c83d2c6aeab54d2c2c9b4d48c3018634554e38/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/d3f6b4e9416bf62053040253609a08d81ca46d1279fc4806ffef1596371a057b/contract";
import endContract from "../../snapshots/d3f6b4e9416bf62053040253609a08d81ca46d1279fc4806ffef1596371a057b/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.createNativeEnumType({
        schema: "public",
        typeName: "DenMembershipEventAction",
        members: [
          "CREATED",
          "JOINED",
          "LEFT",
          "REMOVED",
          "PROMOTED",
          "DEMOTED",
          "OWNER_TRANSFERRED",
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_conversation_membership_events",
        columns: [
          col("action", '"DenMembershipEventAction"', {
            notNull: true,
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "DenMembershipEventAction" },
            },
          }),
          col("actorId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("actorName", "text", { codecRef: { codecId: "pg/text@1" } }),
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
          col("targetName", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("targetUserId", "text", { codecRef: { codecId: "pg/text@1" } }),
        ],
        constraints: [
          primaryKey(["id"], {
            name: "message_conversation_membership_events_pkey",
          }),
        ],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_membership_events",
        index: "mcme_conversationId_createdAt_idx",
        columns: ["conversationId", "createdAt"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_conversation_membership_events",
        foreignKey: {
          name: "message_conversation_membership_events_conversationId_fkey",
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
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
