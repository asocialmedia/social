#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  lit,
} from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/bf68714a648e4a747c8853324157fb0529bdff062c00ca60d65fdc82bc8f6273/contract";
import endContract from "../../snapshots/bf68714a648e4a747c8853324157fb0529bdff062c00ca60d65fdc82bc8f6273/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/c2bdb01f005d03f6607e6443a95397d497e0ec084e656c779530059afc24dece/contract";
import startContract from "../../snapshots/c2bdb01f005d03f6607e6443a95397d497e0ec084e656c779530059afc24dece/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.createNativeEnumType({
        schema: "public",
        typeName: "ConversationType",
        members: ["DM", "DEN"],
      }),
      this.createNativeEnumType({
        schema: "public",
        typeName: "DenRole",
        members: ["OWNER", "ADMIN", "MEMBER"],
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_keys",
        column: col("wrapperPublicKey", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_keys",
        column: col("wrapperUserId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("role", '"DenRole"', {
          notNull: true,
          default: lit("MEMBER"),
          codecRef: {
            codecId: "pg/enum@1",
            typeParams: { typeName: "DenRole" },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("avatarMediaId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("createdById", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("description", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("inviteCode", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("name", "text", { codecRef: { codecId: "pg/text@1" } }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("ownerId", "text", { codecRef: { codecId: "pg/text@1" } }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("type", '"ConversationType"', {
          notNull: true,
          default: lit("DM"),
          codecRef: {
            codecId: "pg/enum@1",
            typeParams: { typeName: "ConversationType" },
          },
        }),
      }),
      this.addCheckConstraint({
        schema: "public",
        table: "message_conversations",
        constraint: "message_conversations_name_length_a6e6f2f3",
        expression: "name IS NULL OR char_length(name) BETWEEN 1 AND 64",
      }),
      this.addUnique({
        schema: "public",
        table: "message_conversations",
        constraint: "message_conversations_inviteCode_key",
        columns: ["inviteCode"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_keys",
        index: "message_conversation_keys_wrapperUserId_idx",
        columns: ["wrapperUserId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_members",
        index: "message_conversation_members_conversationId_role_idx",
        columns: ["conversationId", "role"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversations",
        index: "message_conversations_avatarMediaId_idx",
        columns: ["avatarMediaId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversations",
        index: "message_conversations_createdById_idx_8bf640ed",
        columns: ["createdById"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversations",
        index: "message_conversations_ownerId_idx",
        columns: ["ownerId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversations",
        index: "message_conversations_type_updatedAt_idx",
        columns: ["type", "updatedAt"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_conversation_keys",
        foreignKey: {
          name: "message_conversation_keys_wrapperUserId_fkey",
          columns: ["wrapperUserId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_conversations",
        foreignKey: {
          name: "message_conversations_avatarMediaId_fkey",
          columns: ["avatarMediaId"],
          references: {
            schema: "public",
            table: "post_media",
            columns: ["id"],
          },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_conversations",
        foreignKey: {
          name: "message_conversations_createdById_fkey",
          columns: ["createdById"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_conversations",
        foreignKey: {
          name: "message_conversations_ownerId_fkey",
          columns: ["ownerId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
