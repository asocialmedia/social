#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
} from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/4e644a055f8f94aa959538683b9b34a08a4afe13f6961c085b5be8e417362dc9/contract";
import startContract from "../../snapshots/4e644a055f8f94aa959538683b9b34a08a4afe13f6961c085b5be8e417362dc9/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/acb4b618e109a205ce67ceb4443db6be7100eb14433fc1709edfba09569e3224/contract";
import endContract from "../../snapshots/acb4b618e109a205ce67ceb4443db6be7100eb14433fc1709edfba09569e3224/contract.json" with { type: "json" };

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
      this.addColumn({
        schema: "public",
        table: "posts",
        column: col("externalParentId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "users",
        column: col("networkPreferences", "jsonb", {
          codecRef: { codecId: "pg/jsonb@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "users",
        column: col("networkPreferencesRevision", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
        }),
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
        table: "external_authors",
        index: "external_authors_nextCheckAt_idx_271e69e8",
        columns: ["nextCheckAt"],
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
      this.createIndex({
        schema: "public",
        table: "external_posts",
        index: "external_posts_authorId_idx_e47547ed",
        columns: ["authorId"],
      }),
      this.createIndex({
        schema: "public",
        table: "posts",
        index: "posts_externalParentId_idx_23c1048b",
        columns: ["externalParentId"],
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
      this.addForeignKey({
        schema: "public",
        table: "posts",
        foreignKey: {
          name: "posts_externalParentId_fkey",
          columns: ["externalParentId"],
          references: {
            schema: "public",
            table: "external_posts",
            columns: ["id"],
          },
          onDelete: "setNull",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
