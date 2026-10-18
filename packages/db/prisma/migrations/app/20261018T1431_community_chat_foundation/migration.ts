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
import postgres from "@prisma/orm-postgres/runtime";

import type { Contract as End } from "../../snapshots/9c839112c8e8ca2945725dafd012164801acb8965b8d61075bf16a3745635184/contract";
import endContractJson from "../../snapshots/9c839112c8e8ca2945725dafd012164801acb8965b8d61075bf16a3745635184/contract.json" with { type: "json" };
import type { Contract as Start } from "../../snapshots/a4295fb5d59eb02819eb29d959511250857adafb6a105c3e8a2379ad84e847ec/contract";
import startContract from "../../snapshots/a4295fb5d59eb02819eb29d959511250857adafb6a105c3e8a2379ad84e847ec/contract.json" with { type: "json" };

const endDb = postgres<End>({ contractJson: endContractJson });
const { contract } = endDb;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContractJson;

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
            '("kind" = \'CHANNEL\' AND "parentRoomId" IS NULL AND "channelType" IS NOT NULL AND "sourceMessageId" IS NULL AND "visibility" = \'PUBLIC\') OR ("kind" = \'THREAD\' AND "parentRoomId" IS NOT NULL AND "channelType" IS NULL)'
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
      this.addColumn({
        schema: "public",
        table: "communities",
        column: col("activeMemberCount", "int4", {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: "pg/int4@1" },
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
      this.dataTransform(contract, "backfill-community-chat", {
        check: () =>
          endDb.raw.sql`SELECT c."id"
          FROM public."communities" AS c
          WHERE c."activeMemberCount" <> (
            SELECT count(*)::integer
            FROM public."community_members" AS cm
            WHERE cm."communityId" = c."id" AND cm."status" = 'ACTIVE'
          ) OR NOT EXISTS (
            SELECT 1 FROM public."community_chat_rooms" AS r
            WHERE r."communityId" = c."id" AND r."slug" = 'general'
          )
          LIMIT 1`
            .returnsRow({ id: "pg/text@1" })
            .build(),
        run: [
          () =>
            endDb.raw.sql`UPDATE public."communities" AS c
            SET "activeMemberCount" = (
              SELECT count(*)::integer
              FROM public."community_members" AS cm
              WHERE cm."communityId" = c."id" AND cm."status" = 'ACTIVE'
            )`
              .affectedCount()
              .build(),
          () =>
            endDb.raw.sql`INSERT INTO public."community_chat_rooms"
            ("id", "communityId", "kind", "channelType", "visibility", "name", "slug", "creatorId")
            SELECT gen_random_uuid()::text, c."id", 'CHANNEL', 'TEXT', 'PUBLIC', 'general', 'general', c."ownerId"
            FROM public."communities" AS c
            WHERE NOT EXISTS (
              SELECT 1 FROM public."community_chat_rooms" AS r
              WHERE r."communityId" = c."id" AND r."slug" = 'general'
            )`
              .affectedCount()
              .build(),
        ],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
