#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/4e911d901613b85b603ffa5e1a67bb1186f3f59e04a7cd4adf3c2702e94b36ad/contract";
import startContract from "../../snapshots/4e911d901613b85b603ffa5e1a67bb1186f3f59e04a7cd4adf3c2702e94b36ad/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/c1c1c867d8629d37906397f1f1ceaab3dfaffd156be0ed25955d90484a84ccb1/contract";
import endContract from "../../snapshots/c1c1c867d8629d37906397f1f1ceaab3dfaffd156be0ed25955d90484a84ccb1/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createNativeEnumType({
        schema: "public",
        typeName: "CommunityChatChannelType",
        members: ["TEXT", "ANNOUNCEMENT"],
      }),
      this.createNativeEnumType({
        schema: "public",
        typeName: "CommunityChatReportStatus",
        members: ["OPEN", "RESOLVED", "DISMISSED"],
      }),
      this.createNativeEnumType({
        schema: "public",
        typeName: "CommunityChatRoomKind",
        members: ["CHANNEL", "THREAD"],
      }),
      this.createNativeEnumType({
        schema: "public",
        typeName: "CommunityChatSanctionKind",
        members: ["BAN", "TIMEOUT", "KICK"],
      }),
      this.createNativeEnumType({
        schema: "public",
        typeName: "CommunityChatVisibility",
        members: ["PUBLIC", "PRIVATE"],
      }),
      this.addNativeEnumValue({
        schema: "public",
        typeName: "NotificationType",
        value: "COMMUNITY_CHAT",
      }),
      this.addNativeEnumValue({
        schema: "public",
        typeName: "NotificationType",
        value: "COMMUNITY_JOIN_REQUEST",
      }),
      this.addNativeEnumValue({
        schema: "public",
        typeName: "NotificationType",
        value: "COMMUNITY_JOIN_APPROVED",
      }),
      this.addNativeEnumValue({
        schema: "public",
        typeName: "NotificationType",
        value: "COMMUNITY_JOIN_DECLINED",
      }),
      this.createNativeEnumType({
        schema: "public",
        typeName: "ViewOnceGrantStatus",
        members: ["RESERVED", "ACTIVE", "CLOSED", "EXPIRED", "REVOKED"],
      }),
      this.createTable({
        schema: "public",
        table: "community_chat_audit",
        columns: [
          col("action", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("actorId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("communityId", "text", {
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
          col("details", "jsonb", { codecRef: { codecId: "pg/jsonb@1" } }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("targetId", "text", { codecRef: { codecId: "pg/text@1" } }),
        ],
        constraints: [
          primaryKey(["id"], { name: "community_chat_audit_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "community_chat_messages",
        columns: [
          col("changeSequence", "int8", {
            notNull: true,
            codecRef: { codecId: "pg/int8@1" },
          }),
          col("clientId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("deletedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("editedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("payload", "jsonb", {
            notNull: true,
            codecRef: { codecId: "pg/jsonb@1" },
          }),
          col("replyToId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("revision", "int4", {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("roomId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("senderId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("sequence", "int8", {
            notNull: true,
            codecRef: { codecId: "pg/int8@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "community_chat_messages_pkey" }),
          checkExpression(
            "community_chat_messages_revision_positive_6165c89f",
            '"revision" >= 1'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "community_chat_outbox",
        columns: [
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
          col("payload", "jsonb", { codecRef: { codecId: "pg/jsonb@1" } }),
          col("publishedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("roomId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("sequence", "int8", {
            notNull: true,
            codecRef: { codecId: "pg/int8@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "community_chat_outbox_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "community_chat_pins",
        columns: [
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("messageId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("pinnedById", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("roomId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["roomId", "messageId"], {
            name: "community_chat_pins_pkey",
          }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "community_chat_preferences",
        columns: [
          col("communityId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("mutedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
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
          primaryKey(["communityId", "userId"], {
            name: "community_chat_preferences_pkey",
          }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "community_chat_reactions",
        columns: [
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("emoji", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("messageId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["messageId", "userId", "emoji"], {
            name: "community_chat_reactions_pkey",
          }),
          checkExpression(
            "community_chat_reactions_emoji_length_646c7d08",
            'char_length("emoji") BETWEEN 1 AND 32'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "community_chat_read_states",
        columns: [
          col("readSequence", "int8", {
            notNull: true,
            default: lit("0"),
            codecRef: { codecId: "pg/int8@1" },
          }),
          col("roomId", "text", {
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
        constraints: [
          primaryKey(["roomId", "userId"], {
            name: "community_chat_read_states_pkey",
          }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "community_chat_reports",
        columns: [
          col("communityId", "text", {
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
          col("messageId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("reason", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("reporterId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("reviewNote", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("reviewedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("reviewedById", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("status", '"CommunityChatReportStatus"', {
            notNull: true,
            default: lit("OPEN"),
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "CommunityChatReportStatus" },
            },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "community_chat_reports_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "community_chat_room_members",
        columns: [
          col("communityMemberId", "text", {
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
          col("invitedById", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("roomId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["roomId", "communityMemberId"], {
            name: "community_chat_room_members_pkey",
          }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "community_chat_rooms",
        columns: [
          col("archived", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("changeSequence", "int8", {
            notNull: true,
            default: lit("0"),
            codecRef: { codecId: "pg/int8@1" },
          }),
          col("channelType", '"CommunityChatChannelType"', {
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "CommunityChatChannelType" },
            },
          }),
          col("communityId", "text", {
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
          col("creatorId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("kind", '"CommunityChatRoomKind"', {
            notNull: true,
            default: lit("CHANNEL"),
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "CommunityChatRoomKind" },
            },
          }),
          col("locked", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("name", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("nextSequence", "int8", {
            notNull: true,
            default: lit("0"),
            codecRef: { codecId: "pg/int8@1" },
          }),
          col("parentRoomId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("slowModeSeconds", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("slug", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("sortOrder", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("sourceMessageId", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("topic", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("updatedAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("visibility", '"CommunityChatVisibility"', {
            notNull: true,
            default: lit("PUBLIC"),
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "CommunityChatVisibility" },
            },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "community_chat_rooms_pkey" }),
          checkExpression(
            "community_chat_rooms_name_length_6b6c4303",
            'char_length("name") BETWEEN 1 AND 64'
          ),
          checkExpression(
            "community_chat_rooms_shape_cd57be3d",
            `("kind" = 'CHANNEL' AND "parentRoomId" IS NULL AND "channelType" IS NOT NULL AND "sourceMessageId" IS NULL AND "visibility" = 'PUBLIC') OR ("kind" = 'THREAD' AND "parentRoomId" IS NOT NULL AND "channelType" IS NULL)`
          ),
          checkExpression(
            "community_chat_rooms_slow_mode_range_3fbdb638",
            '"slowModeSeconds" BETWEEN 0 AND 21600'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "community_chat_sanctions",
        columns: [
          col("actorId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("communityId", "text", {
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
          col("expiresAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("kind", '"CommunityChatSanctionKind"', {
            notNull: true,
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "CommunityChatSanctionKind" },
            },
          }),
          col("reason", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "community_chat_sanctions_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "community_chat_subscriptions",
        columns: [
          col("following", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("roomId", "text", {
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
        constraints: [
          primaryKey(["roomId", "userId"], {
            name: "community_chat_subscriptions_pkey",
          }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_export_jobs",
        columns: [
          col("artifactKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("clearedThroughSequence", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
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
          col("errorCode", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("expiresAt", "timestamp(3)", {
            notNull: true,
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("fromDate", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("includeMedia", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("leaseUntil", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("membershipSequence", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("objectKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("recoveryGeneration", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("snapshotSequence", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("status", "text", {
            notNull: true,
            default: lit("pending"),
            codecRef: { codecId: "pg/text@1" },
          }),
          col("toDate", "timestamp(3)", {
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
        constraints: [primaryKey(["id"])],
      }),
      this.createTable({
        schema: "public",
        table: "message_incognito_messages",
        columns: [
          col("ciphertext", "text", {
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
          col("iv", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("keyEpoch", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("ratchetIndex", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("senderId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("sequence", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("sessionId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"])],
      }),
      this.createTable({
        schema: "public",
        table: "message_incognito_sessions",
        columns: [
          col("conversationId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("endReason", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("endedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("endedById", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("endedByName", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("expiresAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("nextSequence", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("purgedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("startedAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("startedById", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("startedByName", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"])],
      }),
      this.createTable({
        schema: "public",
        table: "message_media_links",
        columns: [
          col("deliveryExpiresAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("incognitoMessageId", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("mediaId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("messageId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("viewOnce", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"]),
          checkExpression(
            "message_media_exact_source_cdff524f",
            '("messageId" IS NULL) <> ("incognitoMessageId" IS NULL)'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_reaction_counts",
        columns: [
          col("count", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("emoji", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("incognitoMessageId", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("messageId", "text", { codecRef: { codecId: "pg/text@1" } }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_reaction_counts_pkey" }),
          checkExpression(
            "message_reaction_counts_emoji_length_646c7d08",
            'char_length("emoji") BETWEEN 1 AND 32'
          ),
          checkExpression(
            "message_reaction_counts_exact_source_cdff524f",
            '("messageId" IS NULL) <> ("incognitoMessageId" IS NULL)'
          ),
          checkExpression(
            "message_reaction_counts_positive_4bde5bb6",
            '"count" >= 1'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_reactions",
        columns: [
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("emoji", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("incognitoMessageId", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("messageId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_reactions_pkey" }),
          checkExpression(
            "message_reactions_emoji_length_646c7d08",
            'char_length("emoji") BETWEEN 1 AND 32'
          ),
          checkExpression(
            "message_reactions_exact_source_cdff524f",
            '("messageId" IS NULL) <> ("incognitoMessageId" IS NULL)'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_view_once_grants",
        columns: [
          col("activatedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("closedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("expiresAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("recipientId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("reservedAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("status", '"ViewOnceGrantStatus"', {
            notNull: true,
            default: lit("RESERVED"),
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "ViewOnceGrantStatus" },
            },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_view_once_grants_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_view_once_receipts",
        columns: [
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("incognitoMessageId", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("mediaId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("messageId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("openedAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("seenAt", "timestamp(3)", {
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
          primaryKey(["id"], { name: "message_view_once_receipts_pkey" }),
          checkExpression(
            "view_once_receipts_exact_source_cdff524f",
            '("messageId" IS NULL) <> ("incognitoMessageId" IS NULL)'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_view_once_recipients",
        columns: [
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
          col("mediaLinkId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_view_once_recipients_pkey" }),
        ],
      }),
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
        table: "communities",
        column: col("activeMemberCount", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("clearedAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("clearedThroughSequence", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversation_members",
        column: col("inboxHiddenAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("retentionSeconds", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "message_conversations",
        column: col("retentionVersion", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "messages",
        column: col("expiresAt", "timestamp(3)", {
          codecRef: {
            codecId: "pg/timestamp-temporal@1",
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "notifications",
        column: col("membershipRequestId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "post_media",
        column: col("incognitoSessionId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "post_media",
        column: col("messageLifecycleProtected", "bool", {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: "pg/bool@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "post_media",
        column: col("messageViewOnce", "bool", {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: "pg/bool@1" },
        }),
      }),
      this.addColumn({
        schema: "public",
        table: "post_media",
        column: col("stickerOperationId", "text", {
          codecRef: { codecId: "pg/text@1" },
        }),
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
        table: "community_chat_messages",
        constraint: "community_chat_messages_idempotency_key",
        columns: ["roomId", "senderId", "clientId"],
      }),
      this.addUnique({
        schema: "public",
        table: "community_chat_messages",
        constraint: "community_chat_messages_roomId_sequence_key",
        columns: ["roomId", "sequence"],
      }),
      this.addUnique({
        schema: "public",
        table: "community_chat_outbox",
        constraint: "community_chat_outbox_roomId_sequence_key",
        columns: ["roomId", "sequence"],
      }),
      this.addUnique({
        schema: "public",
        table: "community_chat_reports",
        constraint: "community_chat_reports_message_reporter_key",
        columns: ["messageId", "reporterId"],
      }),
      this.addUnique({
        schema: "public",
        table: "community_chat_rooms",
        constraint: "community_chat_rooms_communityId_slug_key",
        columns: ["communityId", "slug"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_incognito_messages",
        constraint: "message_incognito_messages_sessionId_sequence_key",
        columns: ["sessionId", "sequence"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_incognito_messages",
        constraint: "incognito_message_sender_ratchet",
        columns: ["sessionId", "senderId", "ratchetIndex"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_media_links",
        constraint: "message_media_links_messageId_mediaId_key",
        columns: ["messageId", "mediaId"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_media_links",
        constraint: "message_media_incognito_unique",
        columns: ["incognitoMessageId", "mediaId"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_reaction_counts",
        constraint: "message_reaction_counts_incognito_emoji_unique",
        columns: ["incognitoMessageId", "emoji"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_reaction_counts",
        constraint: "message_reaction_counts_message_emoji_unique",
        columns: ["messageId", "emoji"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_reactions",
        constraint: "message_reactions_incognito_user_unique",
        columns: ["incognitoMessageId", "userId"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_reactions",
        constraint: "message_reactions_message_user_unique",
        columns: ["messageId", "userId"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_view_once_receipts",
        constraint: "view_once_receipts_media_user_key",
        columns: ["mediaId", "userId"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_view_once_recipients",
        constraint: "message_view_once_recipients_media_user_unique",
        columns: ["mediaLinkId", "userId"],
      }),
      this.addUnique({
        schema: "public",
        table: "post_media",
        constraint: "post_media_userId_stickerOperationId_key",
        columns: ["userId", "stickerOperationId"],
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
        table: "community_chat_audit",
        index: "community_chat_audit_timeline_idx",
        columns: ["communityId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_messages",
        index: "community_chat_messages_changes_idx",
        columns: ["roomId", "changeSequence"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_messages",
        index: "community_chat_messages_cursor_idx",
        columns: ["roomId", "createdAt", "id"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_messages",
        index: "community_chat_messages_replyToId_idx_f2e7fcdc",
        columns: ["replyToId"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_messages",
        index: "community_chat_messages_sender_idx",
        columns: ["senderId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_outbox",
        index: "community_chat_outbox_pending_idx",
        columns: ["publishedAt", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_pins",
        index: "community_chat_pins_roomId_createdAt_idx",
        columns: ["roomId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_preferences",
        index: "community_chat_preferences_userId_mutedAt_idx",
        columns: ["userId", "mutedAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_reactions",
        index: "community_chat_reactions_summary_idx",
        columns: ["messageId", "emoji"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_reactions",
        index: "community_chat_reactions_userId_createdAt_idx",
        columns: ["userId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_read_states",
        index: "community_chat_read_states_userId_updatedAt_idx",
        columns: ["userId", "updatedAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_reports",
        index: "community_chat_reports_queue_idx",
        columns: ["communityId", "status", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_reports",
        index: "community_chat_reports_reviewedById_idx_e2835478",
        columns: ["reviewedById"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_room_members",
        index: "community_chat_room_members_communityMemberId_idx",
        columns: ["communityMemberId"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_rooms",
        index: "community_chat_rooms_children_idx",
        columns: ["parentRoomId", "kind", "visibility", "archived"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_rooms",
        index: "community_chat_rooms_creatorId_idx_3a77d800",
        columns: ["creatorId"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_rooms",
        index: "community_chat_rooms_listing_idx",
        columns: ["communityId", "kind", "archived", "sortOrder"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_rooms",
        index: "community_chat_rooms_parentRoomId_idx_cf9c8fcd",
        columns: ["parentRoomId"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_rooms",
        index: "community_chat_rooms_sourceMessageId_idx_0a141d62",
        columns: ["sourceMessageId"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_sanctions",
        index: "community_chat_sanctions_active_idx",
        columns: ["communityId", "userId", "kind", "expiresAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_sanctions",
        index: "community_chat_sanctions_created_idx",
        columns: ["communityId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_chat_subscriptions",
        index: "community_chat_subscriptions_followers_idx",
        columns: ["roomId", "following", "userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_members",
        index: "community_members_request_page_idx",
        columns: ["communityId", "status", "createdAt", "id"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_export_jobs",
        index: "message_export_jobs_conversationId_idx_669215a6",
        columns: ["conversationId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_export_jobs",
        index: "message_export_jobs_expiresAt_idx_6b6b8c10",
        columns: ["expiresAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_export_jobs",
        index: "message_export_jobs_status_createdAt_idx_58610442",
        columns: ["status", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_export_jobs",
        index: "message_export_jobs_userId_idx_a489d58a",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_export_jobs",
        index: "message_export_user_conversation_e3757d35",
        columns: ["userId", "conversationId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_incognito_messages",
        index: "incognito_message_expiry_due_3855cff1",
        columns: ["createdAt", "id"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_incognito_messages",
        index: "message_incognito_messages_senderId_idx_4689c490",
        columns: ["senderId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_incognito_sessions",
        index: "incognito_conversation_started_3327d598",
        columns: ["conversationId", "startedAt", "id"],
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
        table: "message_incognito_sessions",
        index: "message_incognito_due_be6e1003",
        columns: ["expiresAt"],
        extras: { where: '("endedAt" IS NULL)' },
      }),
      this.createIndex({
        schema: "public",
        table: "message_incognito_sessions",
        index: "message_incognito_one_active_556b95fb",
        columns: ["conversationId"],
        extras: { where: '("endedAt" IS NULL)', unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "message_incognito_sessions",
        index: "message_incognito_sessions_endedById_idx_4049a1b9",
        columns: ["endedById"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_incognito_sessions",
        index: "message_incognito_sessions_startedById_idx_a8358300",
        columns: ["startedById"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_media_links",
        index: "message_media_links_incognitoMessageId_idx_6efaf95e",
        columns: ["incognitoMessageId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_media_links",
        index: "message_media_links_mediaId_idx_6b06655c",
        columns: ["mediaId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_media_links",
        index: "message_media_links_messageId_idx_3cdded8d",
        columns: ["messageId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_media_links",
        index: "message_media_viewonce_due_a36050d7",
        columns: ["deliveryExpiresAt", "id"],
        extras: { where: '("viewOnce" AND "deliveryExpiresAt" IS NOT NULL)' },
      }),
      this.createIndex({
        schema: "public",
        table: "message_media_links",
        index: "message_media_viewonce_media_unique_ff0d1126",
        columns: ["mediaId"],
        extras: { where: '("viewOnce")', unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "message_reactions",
        index: "message_reactions_incognito_emoji_idx",
        columns: ["incognitoMessageId", "emoji"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_reactions",
        index: "message_reactions_message_emoji_idx",
        columns: ["messageId", "emoji"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_reactions",
        index: "message_reactions_userId_idx",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_view_once_grants",
        index: "message_view_once_grants_live_unique_1915abed",
        columns: ["recipientId"],
        extras: { where: `("status" IN ('RESERVED', 'ACTIVE'))`, unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "message_view_once_grants",
        index: "message_view_once_grants_status_expiry_idx",
        columns: ["status", "expiresAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_view_once_receipts",
        index: "view_once_receipts_incognito_idx",
        columns: ["incognitoMessageId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_view_once_receipts",
        index: "view_once_receipts_message_idx",
        columns: ["messageId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_view_once_receipts",
        index: "view_once_receipts_user_idx",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_view_once_recipients",
        index: "message_view_once_recipients_userId_idx",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "messages",
        index: "messages_expiry_due_idx_a83a16eb",
        columns: ["expiresAt", "id"],
        extras: { where: '("expiresAt" IS NOT NULL AND "deletedAt" IS NULL)' },
      }),
      this.createIndex({
        schema: "public",
        table: "messages",
        index: "messages_lifecycle_erasure_due_7f300049",
        columns: ["expiresAt", "id"],
        extras: { where: `("expiresAt" IS NOT NULL AND ciphertext <> '')` },
      }),
      this.createIndex({
        schema: "public",
        table: "post_media",
        index: "media_lifecycle_erasure_due_d202ba84",
        columns: ["id"],
        extras: { where: `("failureCode" = 'CHAT_LIFECYCLE_ERASURE')` },
      }),
      this.createIndex({
        schema: "public",
        table: "post_media",
        index: "post_media_incognitoSessionId_idx_e9d021b8",
        columns: ["incognitoSessionId"],
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
        table: "community_chat_audit",
        foreignKey: {
          name: "community_chat_audit_communityId_fkey",
          columns: ["communityId"],
          references: {
            schema: "public",
            table: "communities",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_audit",
        foreignKey: {
          name: "community_chat_audit_actorId_fkey",
          columns: ["actorId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_messages",
        foreignKey: {
          name: "community_chat_messages_roomId_fkey",
          columns: ["roomId"],
          references: {
            schema: "public",
            table: "community_chat_rooms",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_messages",
        foreignKey: {
          name: "community_chat_messages_senderId_fkey",
          columns: ["senderId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_messages",
        foreignKey: {
          name: "community_chat_messages_replyToId_fkey",
          columns: ["replyToId"],
          references: {
            schema: "public",
            table: "community_chat_messages",
            columns: ["id"],
          },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_outbox",
        foreignKey: {
          name: "community_chat_outbox_roomId_fkey",
          columns: ["roomId"],
          references: {
            schema: "public",
            table: "community_chat_rooms",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_pins",
        foreignKey: {
          name: "community_chat_pins_roomId_fkey",
          columns: ["roomId"],
          references: {
            schema: "public",
            table: "community_chat_rooms",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_pins",
        foreignKey: {
          name: "community_chat_pins_messageId_fkey",
          columns: ["messageId"],
          references: {
            schema: "public",
            table: "community_chat_messages",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_pins",
        foreignKey: {
          name: "community_chat_pins_pinnedById_fkey",
          columns: ["pinnedById"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_preferences",
        foreignKey: {
          name: "community_chat_preferences_communityId_fkey",
          columns: ["communityId"],
          references: {
            schema: "public",
            table: "communities",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_preferences",
        foreignKey: {
          name: "community_chat_preferences_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_reactions",
        foreignKey: {
          name: "community_chat_reactions_messageId_fkey",
          columns: ["messageId"],
          references: {
            schema: "public",
            table: "community_chat_messages",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_reactions",
        foreignKey: {
          name: "community_chat_reactions_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_read_states",
        foreignKey: {
          name: "community_chat_read_states_roomId_fkey",
          columns: ["roomId"],
          references: {
            schema: "public",
            table: "community_chat_rooms",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_read_states",
        foreignKey: {
          name: "community_chat_read_states_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_reports",
        foreignKey: {
          name: "community_chat_reports_communityId_fkey",
          columns: ["communityId"],
          references: {
            schema: "public",
            table: "communities",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_reports",
        foreignKey: {
          name: "community_chat_reports_reporterId_fkey",
          columns: ["reporterId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_reports",
        foreignKey: {
          name: "community_chat_reports_reviewedById_fkey",
          columns: ["reviewedById"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_reports",
        foreignKey: {
          name: "community_chat_reports_messageId_fkey",
          columns: ["messageId"],
          references: {
            schema: "public",
            table: "community_chat_messages",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_room_members",
        foreignKey: {
          name: "community_chat_room_members_roomId_fkey",
          columns: ["roomId"],
          references: {
            schema: "public",
            table: "community_chat_rooms",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_room_members",
        foreignKey: {
          name: "community_chat_room_members_communityMemberId_fkey",
          columns: ["communityMemberId"],
          references: {
            schema: "public",
            table: "community_members",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_room_members",
        foreignKey: {
          name: "community_chat_room_members_invitedById_fkey",
          columns: ["invitedById"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_rooms",
        foreignKey: {
          name: "community_chat_rooms_communityId_fkey",
          columns: ["communityId"],
          references: {
            schema: "public",
            table: "communities",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_rooms",
        foreignKey: {
          name: "community_chat_rooms_creatorId_fkey",
          columns: ["creatorId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_rooms",
        foreignKey: {
          name: "community_chat_rooms_parentRoomId_fkey",
          columns: ["parentRoomId"],
          references: {
            schema: "public",
            table: "community_chat_rooms",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_rooms",
        foreignKey: {
          name: "community_chat_rooms_sourceMessageId_fkey",
          columns: ["sourceMessageId"],
          references: {
            schema: "public",
            table: "community_chat_messages",
            columns: ["id"],
          },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_sanctions",
        foreignKey: {
          name: "community_chat_sanctions_communityId_fkey",
          columns: ["communityId"],
          references: {
            schema: "public",
            table: "communities",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_sanctions",
        foreignKey: {
          name: "community_chat_sanctions_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_sanctions",
        foreignKey: {
          name: "community_chat_sanctions_actorId_fkey",
          columns: ["actorId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_subscriptions",
        foreignKey: {
          name: "community_chat_subscriptions_roomId_fkey",
          columns: ["roomId"],
          references: {
            schema: "public",
            table: "community_chat_rooms",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_chat_subscriptions",
        foreignKey: {
          name: "community_chat_subscriptions_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_export_jobs",
        foreignKey: {
          name: "message_export_jobs_conversationId_fkey",
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
        table: "message_export_jobs",
        foreignKey: {
          name: "message_export_jobs_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_incognito_messages",
        foreignKey: {
          name: "message_incognito_messages_sessionId_fkey",
          columns: ["sessionId"],
          references: {
            schema: "public",
            table: "message_incognito_sessions",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_incognito_messages",
        foreignKey: {
          name: "message_incognito_messages_senderId_fkey",
          columns: ["senderId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_incognito_sessions",
        foreignKey: {
          name: "message_incognito_sessions_conversationId_fkey",
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
        table: "message_incognito_sessions",
        foreignKey: {
          name: "message_incognito_sessions_startedById_fkey",
          columns: ["startedById"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_incognito_sessions",
        foreignKey: {
          name: "message_incognito_sessions_endedById_fkey",
          columns: ["endedById"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_media_links",
        foreignKey: {
          name: "message_media_links_messageId_fkey",
          columns: ["messageId"],
          references: { schema: "public", table: "messages", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_media_links",
        foreignKey: {
          name: "message_media_links_incognitoMessageId_fkey",
          columns: ["incognitoMessageId"],
          references: {
            schema: "public",
            table: "message_incognito_messages",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_media_links",
        foreignKey: {
          name: "message_media_links_mediaId_fkey",
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
      this.addForeignKey({
        schema: "public",
        table: "message_reaction_counts",
        foreignKey: {
          name: "message_reaction_counts_messageId_fkey",
          columns: ["messageId"],
          references: { schema: "public", table: "messages", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_reaction_counts",
        foreignKey: {
          name: "message_reaction_counts_incognitoMessageId_fkey",
          columns: ["incognitoMessageId"],
          references: {
            schema: "public",
            table: "message_incognito_messages",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_reactions",
        foreignKey: {
          name: "message_reactions_messageId_fkey",
          columns: ["messageId"],
          references: { schema: "public", table: "messages", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_reactions",
        foreignKey: {
          name: "message_reactions_incognitoMessageId_fkey",
          columns: ["incognitoMessageId"],
          references: {
            schema: "public",
            table: "message_incognito_messages",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_reactions",
        foreignKey: {
          name: "message_reactions_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_view_once_grants",
        foreignKey: {
          name: "message_view_once_grants_recipientId_fkey",
          columns: ["recipientId"],
          references: {
            schema: "public",
            table: "message_view_once_recipients",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_view_once_receipts",
        foreignKey: {
          name: "view_once_receipts_message_fkey",
          columns: ["messageId"],
          references: { schema: "public", table: "messages", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_view_once_receipts",
        foreignKey: {
          name: "view_once_receipts_incognito_fkey",
          columns: ["incognitoMessageId"],
          references: {
            schema: "public",
            table: "message_incognito_messages",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_view_once_receipts",
        foreignKey: {
          name: "view_once_receipts_user_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_view_once_recipients",
        foreignKey: {
          name: "message_view_once_recipients_mediaLinkId_fkey",
          columns: ["mediaLinkId"],
          references: {
            schema: "public",
            table: "message_media_links",
            columns: ["id"],
          },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_view_once_recipients",
        foreignKey: {
          name: "message_view_once_recipients_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
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
