#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
} from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/138af29975c9707748b1aaa401859a1a8c3fd7bfb5ce447ff70199f1193156c0/contract";
import startContract from "../../snapshots/138af29975c9707748b1aaa401859a1a8c3fd7bfb5ce447ff70199f1193156c0/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/ce7d276079293d76321047ab02e8131e5639b24613afbd372a2af1d4d31c9bce/contract";
import endContract from "../../snapshots/ce7d276079293d76321047ab02e8131e5639b24613afbd372a2af1d4d31c9bce/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: "public",
        table: "external_comments",
        columns: [
          col("content", "text", {
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
          col("deleted", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("externalPostId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("requestId", "text", {
            notNull: true,
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
        table: "external_engagements",
        columns: [
          col("amplified", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("bookmarked", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("externalPostId", "text", {
            notNull: true,
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
        constraints: [primaryKey(["userId", "externalPostId"])],
      }),
      this.createTable({
        schema: "public",
        table: "external_posts",
        columns: [
          col("authorId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("available", "bool", {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("checkedAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
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
          col("snapshot", "jsonb", { codecRef: { codecId: "pg/jsonb@1" } }),
          col("source", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("uri", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"])],
      }),
      this.addUnique({
        schema: "public",
        table: "external_comments",
        constraint: "external_comments_userId_requestId_key",
        columns: ["userId", "requestId"],
      }),
      this.addUnique({
        schema: "public",
        table: "external_posts",
        constraint: "external_posts_source_uri_key",
        columns: ["source", "uri"],
      }),
      this.createIndex({
        schema: "public",
        table: "external_comments",
        index: "external_comments_externalPostId_idx_98ecd9ca",
        columns: ["externalPostId"],
      }),
      this.createIndex({
        schema: "public",
        table: "external_comments",
        index: "external_comments_page_idx",
        columns: ["externalPostId", "createdAt", "id"],
      }),
      this.createIndex({
        schema: "public",
        table: "external_comments",
        index: "external_comments_userId_idx_a489d58a",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "external_engagements",
        index: "external_engagement_amplified_idx",
        columns: ["userId", "amplified", "updatedAt", "externalPostId"],
      }),
      this.createIndex({
        schema: "public",
        table: "external_engagements",
        index: "external_engagement_bookmarks_idx",
        columns: ["userId", "bookmarked", "updatedAt", "externalPostId"],
      }),
      this.createIndex({
        schema: "public",
        table: "external_engagements",
        index: "external_engagement_post_idx",
        columns: ["externalPostId", "amplified"],
      }),
      this.createIndex({
        schema: "public",
        table: "external_engagements",
        index: "external_engagements_externalPostId_idx_98ecd9ca",
        columns: ["externalPostId"],
      }),
      this.createIndex({
        schema: "public",
        table: "external_engagements",
        index: "external_engagements_userId_idx_a489d58a",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "external_posts",
        index: "external_posts_authorId_idx_e47547ed",
        columns: ["authorId"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "external_comments",
        foreignKey: {
          name: "external_comments_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "external_comments",
        foreignKey: {
          name: "external_comments_externalPostId_fkey",
          columns: ["externalPostId"],
          references: {
            schema: "public",
            table: "external_posts",
            columns: ["id"],
          },
          onDelete: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "external_engagements",
        foreignKey: {
          name: "external_engagements_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "external_engagements",
        foreignKey: {
          name: "external_engagements_externalPostId_fkey",
          columns: ["externalPostId"],
          references: {
            schema: "public",
            table: "external_posts",
            columns: ["id"],
          },
          onDelete: "cascade",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
