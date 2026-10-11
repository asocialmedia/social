#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
  rawSql,
} from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/bead356b8ab9022bad6b8a21230c3891edf0eec9601f9a399534036b34bb42d8/contract";
import endContract from "../../snapshots/bead356b8ab9022bad6b8a21230c3891edf0eec9601f9a399534036b34bb42d8/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/c2b37d44c45891f704d244735fb801e82788e4202253dc4fec099733ce5b7a23/contract";
import startContract from "../../snapshots/c2b37d44c45891f704d244735fb801e82788e4202253dc4fec099733ce5b7a23/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): Migration<Start, End>["operations"] {
    return [
      this.createNativeEnumType({
        schema: "public",
        typeName: "ConversationType",
        members: ["DM", "DEN"],
      }),
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
      this.createNativeEnumType({
        schema: "public",
        typeName: "DenRole",
        members: ["OWNER", "ADMIN", "MEMBER"],
      }),
      this.createNativeEnumType({
        schema: "public",
        typeName: "GroupAddPolicy",
        members: ["EVERYONE", "FOLLOWING_ONLY", "NO_DIRECT_ADDS"],
      }),
      this.addNativeEnumValue({
        schema: "public",
        typeName: "NotificationType",
        value: "DEN_MESSAGE",
      }),
      this.addNativeEnumValue({
        schema: "public",
        typeName: "NotificationType",
        value: "DEN_MEMBERSHIP_ENDED",
      }),
      this.createTable({
        schema: "public",
        table: "message_conversation_changes",
        columns: [
          col("audienceUserIds", "text[]", {
            notNull: true,
            default: lit([]),
            codecRef: { codecId: "pg/text@1", many: true },
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
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("kind", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("messageId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("revision", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("sequence", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_conversation_changes_pkey" }),
          checkExpression(
            "message_conversation_changes_audienceUserIds_elem_not__5d6452e6",
            'array_position("audienceUserIds", NULL) IS NULL'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_conversation_invite_codes",
        columns: [
          col("code", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("conversationId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("retiredAt", "timestamp(3)", {
            notNull: true,
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
        ],
        constraints: [
          primaryKey(["code"], {
            name: "message_conversation_invite_codes_pkey",
          }),
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
      this.createTable({
        schema: "public",
        table: "message_search_account_state",
        columns: [
          col("recoveryGeneration", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
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
          primaryKey(["userId"], { name: "message_search_account_state_pkey" }),
        ],
      }),
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
      this.createTable({
        schema: "public",
        table: "message_search_coverage",
        columns: [
          col("artifactsCommitted", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("backfillCompletedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("backfillCursorCreatedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("backfillCursorMessageId", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("backfillStartedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("backfillThroughSequence", "int4", {
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("completedChangeSeq", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("conversationId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("hasUnreadableMessages", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("recoveryGeneration", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("rowsTraversed", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("unrecoverableEpochIds", "int4[]", {
            notNull: true,
            default: lit([]),
            codecRef: { codecId: "pg/int4@1", many: true },
          }),
          col("unrecoverableEpochs", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("updatedAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
        ],
        constraints: [
          primaryKey(["conversationId"], {
            name: "message_search_coverage_pkey",
          }),
          checkExpression(
            "message_search_coverage_unrecoverableEpochIds_elem_not_b41414ee",
            'array_position("unrecoverableEpochIds", NULL) IS NULL'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_search_documents",
        columns: [
          col("conversationId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("createdAt", "timestamp(3)", {
            notNull: true,
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("messageId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("revision", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("termIds", "int4[]", {
            notNull: true,
            default: lit([]),
            codecRef: { codecId: "pg/int4@1", many: true },
          }),
        ],
        constraints: [
          primaryKey(["messageId"], { name: "message_search_documents_pkey" }),
          checkExpression(
            "message_search_documents_termIds_elem_not_null_c60d8cf2",
            'array_position("termIds", NULL) IS NULL'
          ),
        ],
      }),
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
      this.createTable({
        schema: "public",
        table: "message_search_gaps",
        columns: [
          col("conversationId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("keyEpoch", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("messageId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("revision", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("unrecoverableEpoch", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
        ],
        constraints: [
          primaryKey(["conversationId", "messageId"], {
            name: "message_search_gaps_pkey",
          }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_search_outbox",
        columns: [
          col("attempts", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("audienceUserIds", "text[]", {
            notNull: true,
            default: lit([]),
            codecRef: { codecId: "pg/text@1", many: true },
          }),
          col("changeSequence", "int4", {
            notNull: true,
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
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("kind", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("messageId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("revision", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_search_outbox_pkey" }),
          checkExpression(
            "message_search_outbox_audienceUserIds_elem_not_null_5d6452e6",
            'array_position("audienceUserIds", NULL) IS NULL'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_search_references",
        columns: [
          col("conversationId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("createdAt", "timestamp(3)", {
            notNull: true,
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("kind", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("mediaKind", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("messageId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("ordinal", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("requiredId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("revision", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
        ],
        constraints: [
          primaryKey(["messageId", "kind", "ordinal"], {
            name: "message_search_references_pkey",
          }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_search_terms",
        columns: [
          col("conversationId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("documentFrequency", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("gramKeys", "text[]", {
            notNull: true,
            codecRef: { codecId: "pg/text@1", many: true },
          }),
          col("id", "SERIAL", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("normalized", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_search_terms_pkey" }),
          checkExpression(
            "message_search_terms_gramKeys_elem_not_null_3012be25",
            'array_position("gramKeys", NULL) IS NULL'
          ),
        ],
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
        column: col("invitedById", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("lastReadSequence", "int4", {
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("leftAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
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
        table: "message_conversation_members",
        column: col("unreadCount", "int4", {
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("wallpaperDim", "int4", {
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("wallpaperKey", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("wallpaperMediaId", "text", {
          codecRef: { codecId: "pg/text@1" },
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
        column: col("changeSeq", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
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
        column: col("inviteDurationDays", "int4", {
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("inviteExpiresAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("inviteShortCode", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("inviteShortCodeDurationDays", "int4", {
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("inviteShortCodeExpiresAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("membershipSeq", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
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
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("wallpaperDim", "int4", {
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("wallpaperKey", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("wallpaperMediaId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "messages",
        column: col("creationSequence", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "messages",
        column: col("keyEpoch", "int4", { codecRef: { codecId: "pg/int4@1" } }),
      }),
      this.addColumn({
        schema: "public",
        table: "messages",
        column: col("revision", "int4", {
          notNull: true,
          default: lit(1),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "notifications",
        column: col("conversationId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "users",
        column: col("groupAddPolicy", '"GroupAddPolicy"', {
          notNull: true,
          default: lit("FOLLOWING_ONLY"),
          codecRef: {
            codecId: "pg/enum@1",
            typeParams: { typeName: "GroupAddPolicy" },
          },
        }),
      }),
      this.addUnique({
        schema: "public",
        table: "message_conversation_changes",
        constraint: "message_conversation_changes_conversation_sequence_key",
        columns: ["conversationId", "sequence"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_conversation_members",
        constraint: "message_conversation_members_wallpaperMediaId_key",
        columns: ["wallpaperMediaId"],
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
      this.addUnique({
        schema: "public",
        table: "message_conversations",
        constraint: "message_conversations_inviteShortCode_key",
        columns: ["inviteShortCode"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_search_count_requests",
        constraint: "message_search_count_requests_request_key_key",
        columns: ["requestKey"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_search_terms",
        constraint: "message_search_terms_conversation_normalized_key",
        columns: ["conversationId", "normalized"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_changes",
        index: "message_conversation_changes_conversation_created_idx",
        columns: ["conversationId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_invite_codes",
        index: "message_conversation_invite_codes_conversationId_retiredAt_idx",
        columns: ["conversationId", "retiredAt"],
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
        table: "message_conversation_members",
        index: "message_conversation_members_invitedById_idx",
        columns: ["invitedById"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_members",
        index: "message_conversation_members_unread_count_idx",
        columns: ["unreadCount"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_membership_events",
        index: "mcme_conversationId_createdAt_idx",
        columns: ["conversationId", "createdAt"],
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
      this.createIndex({
        schema: "public",
        table: "message_conversations",
        index: "message_conversations_wallpaperMediaId_idx_e7014658",
        columns: ["wallpaperMediaId"],
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
      this.createIndex({
        schema: "public",
        table: "message_search_coverage",
        index: "message_search_coverage_backfill_idx",
        columns: ["backfillCompletedAt", "backfillStartedAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_documents",
        index: "message_search_documents_conversation_created_message_idx",
        columns: ["conversationId", "createdAt", "messageId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_documents",
        index: "message_search_documents_term_ids_idx",
        columns: ["termIds"],
        extras: { type: "gin" },
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_epoch_readability",
        index: "message_search_epoch_readability_scope_idx",
        columns: ["conversationId", "userId", "keyEpoch"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_gaps",
        index: "message_search_gaps_epoch_idx",
        columns: ["conversationId", "keyEpoch"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_outbox",
        index: "message_search_outbox_conversation_sequence_idx",
        columns: ["conversationId", "changeSequence"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_outbox",
        index: "message_search_outbox_message_sequence_idx",
        columns: ["messageId", "changeSequence"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_outbox",
        index: "message_search_outbox_pending_created_idx",
        columns: ["completedAt", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_references",
        index: "message_search_references_conversation_kind_created_idx",
        columns: [
          "conversationId",
          "kind",
          "createdAt",
          "messageId",
          "ordinal",
        ],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_terms",
        index: "message_search_terms_conversation_id_idx",
        columns: ["conversationId", "id"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_terms",
        index: "message_search_terms_gram_keys_idx",
        columns: ["gramKeys"],
        extras: { type: "gin" },
      }),
      this.createIndex({
        schema: "public",
        table: "message_search_terms",
        index: "message_search_terms_orphaned_f61e9e26",
        columns: ["conversationId"],
        extras: { where: '("documentFrequency" = 0)' },
      }),
      this.createIndex({
        schema: "public",
        table: "notifications",
        index: "notifications_recipientId_conversationId_type_read_idx",
        columns: ["recipientId", "conversationId", "type", "read"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_conversation_invite_codes",
        foreignKey: {
          name: "message_conversation_invite_codes_conversationId_fkey",
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
        table: "message_conversation_members",
        foreignKey: {
          name: "message_conversation_members_invitedById_fkey",
          columns: ["invitedById"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_conversation_members",
        foreignKey: {
          name: "message_conversation_members_wallpaperMediaId_fkey",
          columns: ["wallpaperMediaId"],
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
      this.addForeignKey({
        schema: "public",
        table: "message_conversations",
        foreignKey: {
          name: "message_conversations_wallpaperMediaId_fkey",
          columns: ["wallpaperMediaId"],
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
      this.addForeignKey({
        schema: "public",
        table: "notifications",
        foreignKey: {
          name: "notifications_conversationId_fkey",
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
      rawSql({
        id: "replace-row-frequency-trigger-with-set-based-triggers",
        label: "Aggregate search term document frequency changes by statement",
        operationClass: "additive",
        target: {
          id: "postgres",
          details: {
            schema: "public",
            objectType: "dependency",
            name: "message_search_term_document_frequency_triggers",
          },
        },
        precheck: [
          {
            description:
              "ensure the statement-level frequency triggers are incomplete",
            sql: `SELECT NOT (
                    NOT EXISTS (
                      SELECT 1
                        FROM pg_catalog.pg_trigger
                       WHERE tgname = 'message_search_term_document_frequency_trigger'
                         AND tgrelid = 'public.message_search_documents'::regclass
                         AND NOT tgisinternal
                    )
                    AND
                    (SELECT COUNT(*) FROM pg_catalog.pg_trigger
                      WHERE tgname IN (
                        'message_search_terms_frequency_after_insert',
                        'message_search_terms_frequency_after_update',
                        'message_search_terms_frequency_after_delete'
                      )
                        AND tgrelid = 'public.message_search_documents'::regclass
                        AND NOT tgisinternal) = 3
                  ) AS result`,
          },
        ],
        execute: [
          {
            description: "reconcile normalized term document frequencies",
            sql: `WITH document_frequencies AS (
                    SELECT term_id, COUNT(*)::int AS frequency
                      FROM public.message_search_documents AS document
                      CROSS JOIN LATERAL unnest(document."termIds") AS term_id
                     GROUP BY term_id
                  )
                  UPDATE public.message_search_terms AS term
                     SET "documentFrequency" = document_frequencies.frequency
                    FROM document_frequencies
                   WHERE term.id = document_frequencies.term_id`,
          },
          {
            description: "remove the row-level frequency trigger",
            sql: `DROP TRIGGER IF EXISTS message_search_term_document_frequency_trigger
                    ON public.message_search_documents`,
          },
          {
            description:
              "remove a partially installed insert frequency trigger",
            sql: `DROP TRIGGER IF EXISTS message_search_terms_frequency_after_insert
                    ON public.message_search_documents`,
          },
          {
            description:
              "remove a partially installed update frequency trigger",
            sql: `DROP TRIGGER IF EXISTS message_search_terms_frequency_after_update
                    ON public.message_search_documents`,
          },
          {
            description:
              "remove a partially installed delete frequency trigger",
            sql: `DROP TRIGGER IF EXISTS message_search_terms_frequency_after_delete
                    ON public.message_search_documents`,
          },
          {
            description:
              "install the set-based document frequency trigger function",
            sql: `CREATE OR REPLACE FUNCTION public.update_message_search_term_document_frequency()
                    RETURNS trigger
                    LANGUAGE plpgsql
                    AS $$
                    BEGIN
                      IF TG_OP = 'INSERT' THEN
                        WITH term_deltas AS (
                          SELECT term_id, COUNT(*)::int AS delta
                            FROM (
                              SELECT DISTINCT document."messageId", terms.term_id
                                FROM new_documents AS document
                                CROSS JOIN LATERAL unnest(document."termIds") AS terms(term_id)
                            ) AS unique_terms
                           GROUP BY term_id
                        )
                        UPDATE public.message_search_terms AS term
                           SET "documentFrequency" = term."documentFrequency" + term_deltas.delta
                          FROM term_deltas
                         WHERE term.id = term_deltas.term_id;
                        RETURN NULL;
                      END IF;
                      IF TG_OP = 'DELETE' THEN
                        WITH term_deltas AS (
                          SELECT term_id, -COUNT(*)::int AS delta
                            FROM (
                              SELECT DISTINCT document."messageId", terms.term_id
                                FROM old_documents AS document
                                CROSS JOIN LATERAL unnest(document."termIds") AS terms(term_id)
                            ) AS unique_terms
                           GROUP BY term_id
                        )
                        UPDATE public.message_search_terms AS term
                           SET "documentFrequency" = term."documentFrequency" + term_deltas.delta
                          FROM term_deltas
                         WHERE term.id = term_deltas.term_id;
                        RETURN NULL;
                      END IF;
                      WITH old_terms AS (
                        SELECT DISTINCT document."messageId", terms.term_id
                          FROM old_documents AS document
                          CROSS JOIN LATERAL unnest(document."termIds") AS terms(term_id)
                      ),
                      new_terms AS (
                        SELECT DISTINCT document."messageId", terms.term_id
                          FROM new_documents AS document
                          CROSS JOIN LATERAL unnest(document."termIds") AS terms(term_id)
                      ),
                      changed_terms AS (
                        SELECT old_term.term_id, -1::int AS delta
                          FROM old_terms AS old_term
                         WHERE NOT EXISTS (
                           SELECT 1 FROM new_terms AS new_term
                            WHERE new_term."messageId" = old_term."messageId"
                              AND new_term.term_id = old_term.term_id
                         )
                        UNION ALL
                        SELECT new_term.term_id, 1::int AS delta
                          FROM new_terms AS new_term
                         WHERE NOT EXISTS (
                           SELECT 1 FROM old_terms AS old_term
                            WHERE old_term."messageId" = new_term."messageId"
                              AND old_term.term_id = new_term.term_id
                         )
                      ),
                      term_deltas AS (
                        SELECT term_id, SUM(delta)::int AS delta
                          FROM changed_terms
                         GROUP BY term_id
                        HAVING SUM(delta) <> 0
                      )
                      UPDATE public.message_search_terms AS term
                         SET "documentFrequency" = term."documentFrequency" + term_deltas.delta
                        FROM term_deltas
                       WHERE term.id = term_deltas.term_id;
                      RETURN NULL;
                    END;
                    $$`,
          },
          {
            description: "create the statement-level insert frequency trigger",
            sql: `CREATE TRIGGER message_search_terms_frequency_after_insert
                    AFTER INSERT ON public.message_search_documents
                    REFERENCING NEW TABLE AS new_documents
                    FOR EACH STATEMENT
                    EXECUTE FUNCTION public.update_message_search_term_document_frequency()`,
          },
          {
            description: "create the statement-level update frequency trigger",
            sql: `CREATE TRIGGER message_search_terms_frequency_after_update
                    AFTER UPDATE ON public.message_search_documents
                    REFERENCING OLD TABLE AS old_documents NEW TABLE AS new_documents
                    FOR EACH STATEMENT
                    EXECUTE FUNCTION public.update_message_search_term_document_frequency()`,
          },
          {
            description: "create the statement-level delete frequency trigger",
            sql: `CREATE TRIGGER message_search_terms_frequency_after_delete
                    AFTER DELETE ON public.message_search_documents
                    REFERENCING OLD TABLE AS old_documents
                    FOR EACH STATEMENT
                    EXECUTE FUNCTION public.update_message_search_term_document_frequency()`,
          },
        ],
        postcheck: [
          {
            description:
              "verify statement-level triggers and exact search term frequencies",
            sql: `SELECT NOT EXISTS (
                    SELECT 1
                      FROM pg_catalog.pg_trigger
                     WHERE tgname = 'message_search_term_document_frequency_trigger'
                       AND tgrelid = 'public.message_search_documents'::regclass
                       AND NOT tgisinternal
                  ) AND (
                    SELECT COUNT(*) = 3
                      FROM pg_catalog.pg_trigger
                     WHERE tgname IN (
                       'message_search_terms_frequency_after_insert',
                       'message_search_terms_frequency_after_update',
                       'message_search_terms_frequency_after_delete'
                     )
                       AND tgrelid = 'public.message_search_documents'::regclass
                       AND NOT tgisinternal
                  ) AND NOT EXISTS (
                    WITH document_frequencies AS (
                      SELECT term_id, COUNT(*)::int AS frequency
                        FROM public.message_search_documents AS document
                        CROSS JOIN LATERAL unnest(document."termIds") AS term_id
                       GROUP BY term_id
                    )
                    SELECT 1
                      FROM public.message_search_terms AS term
                      LEFT JOIN document_frequencies
                        ON document_frequencies.term_id = term.id
                     WHERE term."documentFrequency" <> COALESCE(document_frequencies.frequency, 0)
                  ) AS result`,
          },
        ],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
