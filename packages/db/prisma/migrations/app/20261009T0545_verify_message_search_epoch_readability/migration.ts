#!/usr/bin/env -S bun
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  primaryKey,
} from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/2820a467349490a407b724112822741f1a10f3adb12464ceef6628debfc648ed/contract";
import endContract from "../../snapshots/2820a467349490a407b724112822741f1a10f3adb12464ceef6628debfc648ed/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/ebf1490d0c8bf1fbe92fcd3d6d5947afff5ae483f2a9db3bcae88724c77724a0/contract";
import startContract from "../../snapshots/ebf1490d0c8bf1fbe92fcd3d6d5947afff5ae483f2a9db3bcae88724c77724a0/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): Migration<Start, End>["operations"] {
    return [
      this.createTable({
        schema: "public",
        table: "message_search_epoch_readability",
        columns: [
          col("conversationId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("keyEpoch", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("readable", "bool", {
            notNull: true,
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("recoveryGeneration", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("sourceFingerprint", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("verifiedAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("wrapId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["wrapId"], {
            name: "message_search_epoch_readability_pkey",
          }),
        ],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_epoch_readability",
        index: "message_search_epoch_readability_scope_idx",
        columns: ["conversationId", "userId", "keyEpoch"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_search_epoch_readability",
        foreignKey: {
          name: "message_search_epoch_readability_wrapId_fkey",
          columns: ["wrapId"],
          references: {
            schema: "public",
            table: "message_conversation_keys",
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
