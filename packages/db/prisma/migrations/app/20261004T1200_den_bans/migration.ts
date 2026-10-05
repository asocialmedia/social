#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  primaryKey,
} from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/7e46d468f5e402c512a5fd8fa07d45974d626d8255000e3325e385b60f529e92/contract";
import endContract from "../../snapshots/7e46d468f5e402c512a5fd8fa07d45974d626d8255000e3325e385b60f529e92/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/e22b466270e899c6999ea16449cc712ce3492ae206ec04995ba701ebd62aa4f3/contract";
import startContract from "../../snapshots/e22b466270e899c6999ea16449cc712ce3492ae206ec04995ba701ebd62aa4f3/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.createTable({
        schema: "public",
        table: "message_den_bans",
        columns: [
          col("bannedById", "text", { codecRef: { codecId: "pg/text@1" } }),
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
          col("reason", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["conversationId", "userId"], {
            name: "message_den_bans_pkey",
          }),
        ],
      }),
      this.createIndex({
        schema: "public",
        table: "message_den_bans",
        index: "mdb_conversationId_createdAt_idx",
        columns: ["conversationId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_den_bans",
        index: "mdb_userId_idx",
        columns: ["userId"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_den_bans",
        foreignKey: {
          name: "message_den_bans_conversationId_fkey",
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
        table: "message_den_bans",
        foreignKey: {
          name: "message_den_bans_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_den_bans",
        foreignKey: {
          name: "message_den_bans_bannedById_fkey",
          columns: ["bannedById"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
