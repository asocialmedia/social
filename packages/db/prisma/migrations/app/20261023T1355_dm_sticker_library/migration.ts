#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
} from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/63d9a61e250e4f148de147056f1c225a606ecf5048a0dc687b48d5c9b32e2c7c/contract";
import startContract from "../../snapshots/63d9a61e250e4f148de147056f1c225a606ecf5048a0dc687b48d5c9b32e2c7c/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/db55bebbf5d57bf32caa0b439698bddc2d2f0a646c8e49c2359b1b594eb0a65e/contract";
import endContract from "../../snapshots/db55bebbf5d57bf32caa0b439698bddc2d2f0a646c8e49c2359b1b594eb0a65e/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: "public",
        table: "user_stickers",
        columns: [
          col("animated", "bool", {
            notNull: true,
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("byteSize", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("favorite", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("lastUsedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("mediaId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("name", "text", {
            notNull: true,
            default: lit(""),
            codecRef: { codecId: "pg/text@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "user_stickers_pkey" })],
      }),
      this.addColumn({
        schema: "public",
        table: "post_media",
        column: col("stickerSource", "bool", {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: "pg/bool@1" },
        }),
      }),
      this.addUnique({
        schema: "public",
        table: "user_stickers",
        constraint: "user_stickers_mediaId_key",
        columns: ["mediaId"],
      }),
      this.addUnique({
        schema: "public",
        table: "user_stickers",
        constraint: "user_stickers_userId_mediaId_key",
        columns: ["userId", "mediaId"],
      }),
      this.createIndex({
        schema: "public",
        table: "user_stickers",
        index: "user_stickers_userId_createdAt_id_idx",
        columns: ["userId", "createdAt", "id"],
      }),
      this.createIndex({
        schema: "public",
        table: "user_stickers",
        index: "user_stickers_userId_favorite_createdAt_idx",
        columns: ["userId", "favorite", "createdAt"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "user_stickers",
        foreignKey: {
          name: "user_stickers_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "user_stickers",
        foreignKey: {
          name: "user_stickers_mediaId_fkey",
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
