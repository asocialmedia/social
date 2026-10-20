#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
} from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/a3ba1e560e658ad38ccb06e359f66cb96aafd975ba3225f0ee69c28f3e1280b5/contract";
import endContract from "../../snapshots/a3ba1e560e658ad38ccb06e359f66cb96aafd975ba3225f0ee69c28f3e1280b5/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/feccf7a05ebbcd758ed6dcc7123258aba4f9ec9ee462138ff17a96901680ca31/contract";
import startContract from "../../snapshots/feccf7a05ebbcd758ed6dcc7123258aba4f9ec9ee462138ff17a96901680ca31/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: "public",
        table: "external_authors",
        columns: [
          col("did", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("displayName", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("handle", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("nextCheckAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("status", "text", {
            notNull: true,
            default: lit("active"),
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["did"])],
      }),
      this.createTable({
        schema: "public",
        table: "external_follows",
        columns: [
          col("authorDid", "text", {
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
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["userId", "authorDid"])],
      }),
      this.createIndex({
        schema: "public",
        table: "external_authors",
        index: "external_authors_nextCheckAt_idx_271e69e8",
        columns: ["nextCheckAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "external_follows",
        index: "external_follows_authorDid_idx_823d3cb1",
        columns: ["authorDid"],
      }),
      this.createIndex({
        schema: "public",
        table: "external_follows",
        index: "external_follows_userId_idx_a489d58a",
        columns: ["userId"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "external_follows",
        foreignKey: {
          name: "external_follows_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "external_follows",
        foreignKey: {
          name: "external_follows_authorDid_fkey",
          columns: ["authorDid"],
          references: {
            schema: "public",
            table: "external_authors",
            columns: ["did"],
          },
          onDelete: "cascade",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
