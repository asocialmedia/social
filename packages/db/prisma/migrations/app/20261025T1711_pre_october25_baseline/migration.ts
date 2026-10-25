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

import type { Contract as End } from "../../snapshots/e5e50f0b7714b63f67e04423b02c183ad20bf9eaf36fb535e6235e7430090bfc/contract";
import endContract from "../../snapshots/e5e50f0b7714b63f67e04423b02c183ad20bf9eaf36fb535e6235e7430090bfc/contract.json" with { type: "json" };

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: "public" }),
      this.createNativeEnumType({
        schema: "public",
        typeName: "AuraType",
        members: [
          "POST_CREATION",
          "POST_ATTACHMENT_BONUS",
          "POST_VOTE",
          "POST_VOTE_REMOVED",
          "POST_VIEWS_MILESTONE",
          "COMMENT_CREATION",
          "COMMENT_RECEIVED",
          "FOLLOW_GAINED",
          "FOLLOW_GIVEN",
          "POST_BOOKMARKED",
          "POST_BOOKMARK_RECEIVED",
          "COMMENT_VOTE",
          "COMMENT_VOTE_REMOVED",
          "MODERATION_PENALTY",
          "MUTING_COST",
          "SHARE_MILESTONE",
          "HN_SHARE_BONUS",
          "MENTION_RECEIVED",
          "TRENDING_APPEARANCE",
          "COMMUNITY_CREATED",
          "COMMUNITY_JOIN",
          "COMMUNITY_JOIN_OWNER",
        ],
      }),
      this.createNativeEnumType({
        schema: "public",
        typeName: "CommunityMemberStatus",
        members: ["ACTIVE", "PENDING"],
      }),
      this.createNativeEnumType({
        schema: "public",
        typeName: "CommunityRole",
        members: ["OWNER", "MODERATOR", "MEMBER", "PARTICIPANT"],
      }),
      this.createNativeEnumType({
        schema: "public",
        typeName: "CommunityType",
        members: ["PUBLIC", "RESTRICTED", "PRIVATE"],
      }),
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
      this.createNativeEnumType({
        schema: "public",
        typeName: "MediaStatus",
        members: [
          "UPLOADING",
          "QUARANTINED",
          "SCANNING",
          "PROCESSING",
          "READY",
          "FAILED",
          "REJECTED",
          "DELETED",
        ],
      }),
      this.createNativeEnumType({
        schema: "public",
        typeName: "MediaType",
        members: ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"],
      }),
      this.createNativeEnumType({
        schema: "public",
        typeName: "MediaVisibility",
        members: ["PUBLIC", "UNLISTED", "PRIVATE"],
      }),
      this.createNativeEnumType({
        schema: "public",
        typeName: "NotificationType",
        members: [
          "AMPLIFY",
          "FOLLOW",
          "COMMENT",
          "MENTION",
          "MODERATION",
          "PUBLISHED",
          "TRANSCRIPTION",
          "REPLY",
          "COMMUNITY_POST",
          "DEN_MESSAGE",
          "DEN_MEMBERSHIP_ENDED",
        ],
      }),
      this.createNativeEnumType({
        schema: "public",
        typeName: "RejectionReason",
        members: [
          "MALWARE",
          "MIME_MISMATCH",
          "UNSUPPORTED_TYPE",
          "TOO_LARGE",
          "TOO_LONG",
          "CORRUPT",
          "POLICY",
        ],
      }),
      this.createTable({
        schema: "public",
        table: "HNBookmark",
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
          col("storyId", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "HNBookmark_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "Tag",
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
          col("name", "text", {
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
        ],
        constraints: [primaryKey(["id"], { name: "Tag_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "_PostToTag",
        columns: [
          col("A", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("B", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["A", "B"], { name: "_PostToTag_AB_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "accounts",
        columns: [
          col("accessToken", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("accessTokenExpiresAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("accountId", "text", {
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
          col("idToken", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("issuer", "text", {
            notNull: true,
            default: lit(""),
            codecRef: { codecId: "pg/text@1" },
          }),
          col("password", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("providerId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("refreshToken", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("refreshTokenExpiresAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("scope", "text", { codecRef: { codecId: "pg/text@1" } }),
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
        constraints: [primaryKey(["id"], { name: "accounts_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "aura_logs",
        columns: [
          col("amount", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("commentId", "text", { codecRef: { codecId: "pg/text@1" } }),
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
          col("issuerId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("postId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("targetUserId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("type", '"AuraType"', {
            notNull: true,
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "AuraType" },
            },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "aura_logs_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "blocks",
        columns: [
          col("blockedId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("blockerId", "text", {
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
        ],
        constraints: [
          primaryKey(["blockerId", "blockedId"], { name: "blocks_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "bookmarks",
        columns: [
          col("authorAura", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("bookmarkerAura", "int4", {
            notNull: true,
            default: lit(0),
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
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("postId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "bookmarks_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "comment_votes",
        columns: [
          col("awardedAura", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("commentId", "text", {
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
          col("mutingCostAura", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("value", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
        ],
        constraints: [
          primaryKey(["userId", "commentId"], { name: "comment_votes_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "comments",
        columns: [
          col("aura", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
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
          col("creationAura", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("deleted", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("parentId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("postId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("postReceivedAura", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("receivedAura", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("rootId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "comments_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "communities",
        columns: [
          col("accentColor", "text", {
            notNull: true,
            default: lit("slate"),
            codecRef: { codecId: "pg/text@1" },
          }),
          col("avatarKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("avatarMediaId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("avatarUrl", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("bannerKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("bannerMediaId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("bannerUrl", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("description", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("mature", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("name", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("ownerId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("slug", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("topics", "text[]", {
            codecRef: { codecId: "pg/text@1", many: true },
          }),
          col("type", '"CommunityType"', {
            notNull: true,
            default: lit("PUBLIC"),
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "CommunityType" },
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
        ],
        constraints: [
          primaryKey(["id"], { name: "communities_pkey" }),
          checkExpression(
            "communities_topics_elem_not_null_1acb8bbc",
            'array_position("topics", NULL) IS NULL'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "community_join_bonuses",
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
          col("joinerAura", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("ownerAura", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "community_join_bonuses_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "community_members",
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
          col("role", '"CommunityRole"', {
            notNull: true,
            default: lit("PARTICIPANT"),
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "CommunityRole" },
            },
          }),
          col("status", '"CommunityMemberStatus"', {
            notNull: true,
            default: lit("ACTIVE"),
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "CommunityMemberStatus" },
            },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "community_members_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "community_post_shares",
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
          col("postId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("sourcePostId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "community_post_shares_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "community_subscriptions",
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
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "community_subscriptions_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "community_visits",
        columns: [
          col("communityId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("visitedAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "community_visits_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "device_push_tokens",
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
          col("platform", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("provider", "text", {
            notNull: true,
            default: lit("fcm"),
            codecRef: { codecId: "pg/text@1" },
          }),
          col("token", "text", {
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
        constraints: [primaryKey(["id"], { name: "device_push_tokens_pkey" })],
      }),
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
      this.createTable({
        schema: "public",
        table: "follows",
        columns: [
          col("followerId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("followingId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("gainedAura", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("givenAura", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
        ],
        constraints: [
          primaryKey(["followerId", "followingId"], { name: "follows_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "hn_story_shares",
        columns: [
          col("by", "text", {
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
          col("descendants", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("postId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("score", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("storyId", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("time", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("title", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("url", "text", { codecRef: { codecId: "pg/text@1" } }),
        ],
        constraints: [primaryKey(["id"], { name: "hn_story_shares_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "jwks",
        columns: [
          col("alg", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("crv", "text", { codecRef: { codecId: "pg/text@1" } }),
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
          col("privateKey", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("publicKey", "text", {
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
        ],
        constraints: [primaryKey(["id"], { name: "jwks_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "mentions",
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
          col("postId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "mentions_pkey" })],
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
        table: "message_conversation_keys",
        columns: [
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
          col("encryptedKey", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("iv", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("ownerUserId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("ratchetCounter", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("version", "int4", {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("wrapperPublicKey", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("wrapperUserId", "text", { codecRef: { codecId: "pg/text@1" } }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_conversation_keys_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_conversation_members",
        columns: [
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
          col("invitedById", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("lastDeliveredAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("lastReadAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("lastReadSequence", "int4", {
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("leftAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("mutedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("role", '"DenRole"', {
            notNull: true,
            default: lit("MEMBER"),
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "DenRole" },
            },
          }),
          col("themeKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("unreadCount", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("wallpaperDim", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("wallpaperKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("wallpaperMediaId", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["conversationId", "userId"], {
            name: "message_conversation_members_pkey",
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
        table: "message_conversations",
        columns: [
          col("avatarMediaId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("changeSeq", "int4", {
            notNull: true,
            default: lit(0),
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
          col("createdById", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("description", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("inviteCode", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("inviteDurationDays", "int4", {
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("inviteExpiresAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("inviteShortCode", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("inviteShortCodeDurationDays", "int4", {
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("inviteShortCodeExpiresAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("membershipSeq", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("name", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("ownerId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("pairKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("type", '"ConversationType"', {
            notNull: true,
            default: lit("DM"),
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "ConversationType" },
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
          col("wallpaperDim", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("wallpaperKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("wallpaperMediaId", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_conversations_pkey" }),
          checkExpression(
            "message_conversations_name_length_a6e6f2f3",
            "name IS NULL OR char_length(name) BETWEEN 1 AND 64"
          ),
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
        table: "message_hidden",
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
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["messageId", "userId"], { name: "message_hidden_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_identities",
        columns: [
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("encryptedPrivateKey", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("kdfIterations", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("masterKeyHash", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("publicKey", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("salt", "text", {
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
          primaryKey(["userId"], { name: "message_identities_pkey" }),
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
      this.createTable({
        schema: "public",
        table: "messages",
        columns: [
          col("ciphertext", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
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
          col("creationSequence", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
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
          col("iv", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("keyEpoch", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("ratchetIndex", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("revision", "int4", {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("senderId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "messages_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "notifications",
        columns: [
          col("commentId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("communityId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("conversationId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("count", "int4", {
            notNull: true,
            default: lit(1),
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
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("issuerId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("postId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("read", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("recipientId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("type", '"NotificationType"', {
            notNull: true,
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "NotificationType" },
            },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "notifications_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "passkey",
        columns: [
          col("aaguid", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("backedUp", "bool", {
            notNull: true,
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("counter", "int4", {
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
          col("credentialID", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("deviceType", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("name", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("publicKey", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("transports", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "passkey_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "password_reset_tokens",
        columns: [
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("expiresAt", "timestamp(3)", {
            notNull: true,
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("token", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "password_reset_tokens_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "post_media",
        columns: [
          col("aiGenerated", "bool", { codecRef: { codecId: "pg/bool@1" } }),
          col("aiProvenance", "jsonb", { codecRef: { codecId: "pg/jsonb@1" } }),
          col("altText", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("attempts", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("audioOverlayId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("blurDataUrl", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("captionsKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("claimedMime", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("commentId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("customThumbnailKey", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("detectedMime", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("duplicateOf", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("encoderVersion", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("exifStripped", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("failureCode", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("failureDetail", "jsonb", {
            codecRef: { codecId: "pg/jsonb@1" },
          }),
          col("generatedAltText", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("hasHls", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("height", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("key", "text", {
            notNull: true,
            default: lit(""),
            codecRef: { codecId: "pg/text@1" },
          }),
          col("messageConversationId", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("mimeType", "text", {
            notNull: true,
            default: lit("application/octet-stream"),
            codecRef: { codecId: "pg/text@1" },
          }),
          col("ocrText", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("originalKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("originalName", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("originalProvenanceId", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("phash", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("pipelineVersion", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("platform", "text", {
            notNull: true,
            default: lit("asocialmedia.cc"),
            codecRef: { codecId: "pg/text@1" },
          }),
          col("postId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("processedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("publishedKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("reShareChecked", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("rejectedReason", '"RejectionReason"', {
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "RejectionReason" },
            },
          }),
          col("safety", "jsonb", { codecRef: { codecId: "pg/jsonb@1" } }),
          col("semanticTags", "text[]", {
            codecRef: { codecId: "pg/text@1", many: true },
          }),
          col("semantics", "jsonb", { codecRef: { codecId: "pg/jsonb@1" } }),
          col("sha256", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("size", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("status", '"MediaStatus"', {
            notNull: true,
            default: lit("UPLOADING"),
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "MediaStatus" },
            },
          }),
          col("techMetadata", "jsonb", { codecRef: { codecId: "pg/jsonb@1" } }),
          col("thumbnailHeight", "int4", {
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("thumbnailKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("thumbnailWidth", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("transcript", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("type", '"MediaType"', {
            notNull: true,
            default: lit("IMAGE"),
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "MediaType" },
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
          col("uploaderDisplayName", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("uploaderUsername", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("url", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("userId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("visibility", '"MediaVisibility"', {
            notNull: true,
            default: lit("PUBLIC"),
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "MediaVisibility" },
            },
          }),
          col("width", "int4", { codecRef: { codecId: "pg/int4@1" } }),
        ],
        constraints: [
          primaryKey(["id"], { name: "post_media_pkey" }),
          checkExpression(
            "post_media_semanticTags_elem_not_null_a6b101f4",
            'array_position("semanticTags", NULL) IS NULL'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "post_media_derivatives",
        columns: [
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("durationMs", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("height", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("key", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("kind", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("mediaId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("mimeType", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("pipelineVersion", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("sizeBytes", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("variant", "text", {
            notNull: true,
            default: lit("default"),
            codecRef: { codecId: "pg/text@1" },
          }),
          col("width", "int4", { codecRef: { codecId: "pg/int4@1" } }),
        ],
        constraints: [
          primaryKey(["id"], { name: "post_media_derivatives_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "post_visits",
        columns: [
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("postId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("visitedAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "post_visits_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "posts",
        columns: [
          col("aura", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("communityId", "text", { codecRef: { codecId: "pg/text@1" } }),
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
          col("embedding", "float8[]", {
            codecRef: { codecId: "pg/float8@1", many: true },
          }),
          col("embeddingFingerprint", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("embeddingModel", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("embeds", "jsonb", { codecRef: { codecId: "pg/jsonb@1" } }),
          col("explicitContent", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("externalParentId", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("isGust", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("lastAwardedShareCount", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("lastAwardedViewCount", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("moderated", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("parentPostId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("rootPostId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("semanticTags", "text[]", {
            codecRef: { codecId: "pg/text@1", many: true },
          }),
          col("threadTopId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("trendingScore", "float8", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/float8@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("viewCount", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "posts_pkey" }),
          checkExpression(
            "posts_embedding_elem_not_null_10a46759",
            'array_position("embedding", NULL) IS NULL'
          ),
          checkExpression(
            "posts_semanticTags_elem_not_null_a6b101f4",
            'array_position("semanticTags", NULL) IS NULL'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "push_subscriptions",
        columns: [
          col("auth", "text", {
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
          col("endpoint", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("p256dh", "text", {
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
          col("userAgent", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "push_subscriptions_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "recommendation_events",
        columns: [
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("dedupeKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("durationMs", "int4", { codecRef: { codecId: "pg/int4@1" } }),
          col("eventType", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("postId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("rankingContext", "json", { codecRef: { codecId: "pg/json@1" } }),
          col("sessionId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("value", "float8", { codecRef: { codecId: "pg/float8@1" } }),
        ],
        constraints: [
          primaryKey(["id"], { name: "recommendation_events_pkey" }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "sessions",
        columns: [
          col("country", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("expiresAt", "timestamp(3)", {
            notNull: true,
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("impersonatedBy", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("ipAddress", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("token", "text", {
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
          col("userAgent", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "sessions_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "share_stats",
        columns: [
          col("clicks", "int4", {
            notNull: true,
            default: lit(0),
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
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("platform", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("postId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("shares", "int4", {
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
        constraints: [primaryKey(["id"], { name: "share_stats_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "twoFactor",
        columns: [
          col("backupCodes", "text", {
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
          col("failedVerificationCount", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("lockedUntil", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("secret", "text", {
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
          col("verified", "bool", {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: "pg/bool@1" },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "twoFactor_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "username_aliases",
        columns: [
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("expiresAt", "timestamp(3)", {
            notNull: true,
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("username", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "username_aliases_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "users",
        columns: [
          col("aura", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("avatarKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("avatarMediaId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("avatarUrl", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("badge", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("badges", "text[]", {
            codecRef: { codecId: "pg/text@1", many: true },
          }),
          col("banExpires", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("banReason", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("banned", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("bannerKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("bannerMediaId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("bannerUrl", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("bio", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("customDomain", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("discordId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("displayName", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("displayUsername", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("email", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("emailVerified", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("emailVerifiedAt", "timestamp(3)", {
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("githubId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("githubUsername", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("googleId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("groupAddPolicy", '"GroupAddPolicy"', {
            notNull: true,
            default: lit("FOLLOWING_ONLY"),
            codecRef: {
              codecId: "pg/enum@1",
              typeParams: { typeName: "GroupAddPolicy" },
            },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("image", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("lastLoginMethod", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("linkedinUsername", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("name", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("networkPreferences", "jsonb", {
            codecRef: { codecId: "pg/jsonb@1" },
          }),
          col("networkPreferencesRevision", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("passwordHash", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("redditId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("redditUsername", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("role", "text", {
            notNull: true,
            default: lit("user"),
            codecRef: { codecId: "pg/text@1" },
          }),
          col("twitterId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("twitterUsername", "text", {
            codecRef: { codecId: "pg/text@1" },
          }),
          col("twoFactorEnabled", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
          }),
          col("updatedAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("username", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "users_pkey" }),
          checkExpression(
            "users_badges_elem_not_null_6fdc1213",
            'array_position("badges", NULL) IS NULL'
          ),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "verification",
        columns: [
          col("createdAt", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("expiresAt", "timestamp(3)", {
            notNull: true,
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("id", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("identifier", "text", {
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
          col("userId", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("value", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "verification_pkey" })],
      }),
      this.createTable({
        schema: "public",
        table: "votes",
        columns: [
          col("awardedAura", "int4", {
            notNull: true,
            default: lit(0),
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
          col("mutingCostAura", "int4", {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: "pg/int4@1" },
          }),
          col("postId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("userId", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
          col("value", "int4", {
            notNull: true,
            codecRef: { codecId: "pg/int4@1" },
          }),
        ],
        constraints: [primaryKey(["userId", "postId"], { name: "votes_pkey" })],
      }),
      this.addUnique({
        schema: "public",
        table: "HNBookmark",
        constraint: "HNBookmark_userId_storyId_key",
        columns: ["userId", "storyId"],
      }),
      this.addUnique({
        schema: "public",
        table: "Tag",
        constraint: "Tag_name_key",
        columns: ["name"],
      }),
      this.addUnique({
        schema: "public",
        table: "accounts",
        constraint: "accounts_providerId_accountId_key",
        columns: ["providerId", "accountId"],
      }),
      this.addUnique({
        schema: "public",
        table: "bookmarks",
        constraint: "bookmarks_userId_postId_key",
        columns: ["userId", "postId"],
      }),
      this.addUnique({
        schema: "public",
        table: "communities",
        constraint: "communities_avatarMediaId_key",
        columns: ["avatarMediaId"],
      }),
      this.addUnique({
        schema: "public",
        table: "communities",
        constraint: "communities_bannerMediaId_key",
        columns: ["bannerMediaId"],
      }),
      this.addUnique({
        schema: "public",
        table: "communities",
        constraint: "communities_slug_key",
        columns: ["slug"],
      }),
      this.addUnique({
        schema: "public",
        table: "community_join_bonuses",
        constraint: "community_join_bonuses_communityId_userId_key",
        columns: ["communityId", "userId"],
      }),
      this.addUnique({
        schema: "public",
        table: "community_members",
        constraint: "community_members_communityId_userId_key",
        columns: ["communityId", "userId"],
      }),
      this.addUnique({
        schema: "public",
        table: "community_post_shares",
        constraint: "community_post_shares_postId_key",
        columns: ["postId"],
      }),
      this.addUnique({
        schema: "public",
        table: "community_subscriptions",
        constraint: "community_subscriptions_communityId_userId_key",
        columns: ["communityId", "userId"],
      }),
      this.addUnique({
        schema: "public",
        table: "community_visits",
        constraint: "community_visits_communityId_userId_key",
        columns: ["communityId", "userId"],
      }),
      this.addUnique({
        schema: "public",
        table: "device_push_tokens",
        constraint: "device_push_tokens_token_key",
        columns: ["token"],
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
      this.addUnique({
        schema: "public",
        table: "hn_story_shares",
        constraint: "hn_story_shares_postId_key",
        columns: ["postId"],
      }),
      this.addUnique({
        schema: "public",
        table: "mentions",
        constraint: "mentions_postId_userId_key",
        columns: ["postId", "userId"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_conversation_changes",
        constraint: "message_conversation_changes_conversation_sequence_key",
        columns: ["conversationId", "sequence"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_conversation_keys",
        constraint:
          "message_conversation_keys_conversationId_ownerUserId_versio_key",
        columns: ["conversationId", "ownerUserId", "version"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_conversation_members",
        constraint: "message_conversation_members_wallpaperMediaId_key",
        columns: ["wallpaperMediaId"],
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
        table: "message_conversations",
        constraint: "message_conversations_pairKey_key",
        columns: ["pairKey"],
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
      this.addUnique({
        schema: "public",
        table: "messages",
        constraint: "messages_conversationId_senderId_ratchetIndex_key",
        columns: ["conversationId", "senderId", "ratchetIndex"],
      }),
      this.addUnique({
        schema: "public",
        table: "passkey",
        constraint: "passkey_credentialID_key",
        columns: ["credentialID"],
      }),
      this.addUnique({
        schema: "public",
        table: "password_reset_tokens",
        constraint: "password_reset_tokens_token_key",
        columns: ["token"],
      }),
      this.addUnique({
        schema: "public",
        table: "post_media",
        constraint: "post_media_audioOverlayId_key",
        columns: ["audioOverlayId"],
      }),
      this.addUnique({
        schema: "public",
        table: "post_media_derivatives",
        constraint: "post_media_derivatives_mediaId_kind_variant_key",
        columns: ["mediaId", "kind", "variant"],
      }),
      this.addUnique({
        schema: "public",
        table: "post_visits",
        constraint: "post_visits_userId_postId_key",
        columns: ["userId", "postId"],
      }),
      this.addUnique({
        schema: "public",
        table: "push_subscriptions",
        constraint: "push_subscriptions_endpoint_key",
        columns: ["endpoint"],
      }),
      this.addUnique({
        schema: "public",
        table: "recommendation_events",
        constraint: "recommendation_events_dedupeKey_key",
        columns: ["dedupeKey"],
      }),
      this.addUnique({
        schema: "public",
        table: "sessions",
        constraint: "sessions_token_key",
        columns: ["token"],
      }),
      this.addUnique({
        schema: "public",
        table: "share_stats",
        constraint: "share_stats_postId_platform_key",
        columns: ["postId", "platform"],
      }),
      this.addUnique({
        schema: "public",
        table: "twoFactor",
        constraint: "twoFactor_userId_key",
        columns: ["userId"],
      }),
      this.addUnique({
        schema: "public",
        table: "username_aliases",
        constraint: "username_aliases_username_key",
        columns: ["username"],
      }),
      this.addUnique({
        schema: "public",
        table: "users",
        constraint: "users_avatarMediaId_key",
        columns: ["avatarMediaId"],
      }),
      this.addUnique({
        schema: "public",
        table: "users",
        constraint: "users_bannerMediaId_key",
        columns: ["bannerMediaId"],
      }),
      this.addUnique({
        schema: "public",
        table: "users",
        constraint: "users_discordId_key",
        columns: ["discordId"],
      }),
      this.addUnique({
        schema: "public",
        table: "users",
        constraint: "users_email_key",
        columns: ["email"],
      }),
      this.addUnique({
        schema: "public",
        table: "users",
        constraint: "users_githubId_key",
        columns: ["githubId"],
      }),
      this.addUnique({
        schema: "public",
        table: "users",
        constraint: "users_googleId_key",
        columns: ["googleId"],
      }),
      this.addUnique({
        schema: "public",
        table: "users",
        constraint: "users_redditId_key",
        columns: ["redditId"],
      }),
      this.addUnique({
        schema: "public",
        table: "users",
        constraint: "users_twitterId_key",
        columns: ["twitterId"],
      }),
      this.addUnique({
        schema: "public",
        table: "users",
        constraint: "users_username_key",
        columns: ["username"],
      }),
      this.createIndex({
        schema: "public",
        table: "HNBookmark",
        index: "HNBookmark_userId_createdAt_idx",
        columns: ["userId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "HNBookmark",
        index: "HNBookmark_userId_idx",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "_PostToTag",
        index: "_PostToTag_B_index",
        columns: ["B"],
      }),
      this.createIndex({
        schema: "public",
        table: "accounts",
        index: "accounts_issuer_accountId_idx",
        columns: ["issuer", "accountId"],
      }),
      this.createIndex({
        schema: "public",
        table: "aura_logs",
        index: "aura_logs_issuerId_targetUserId_createdAt_idx",
        columns: ["issuerId", "targetUserId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "aura_logs",
        index: "aura_logs_userId_createdAt_idx",
        columns: ["userId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "blocks",
        index: "blocks_blockedId_idx",
        columns: ["blockedId"],
      }),
      this.createIndex({
        schema: "public",
        table: "bookmarks",
        index: "bookmarks_postId_idx",
        columns: ["postId"],
      }),
      this.createIndex({
        schema: "public",
        table: "bookmarks",
        index: "bookmarks_userId_createdAt_idx",
        columns: ["userId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "comment_votes",
        index: "comment_votes_commentId_value_idx",
        columns: ["commentId", "value"],
      }),
      this.createIndex({
        schema: "public",
        table: "comments",
        index: "comments_postId_createdAt_idx",
        columns: ["postId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "comments",
        index: "comments_postId_parentId_idx",
        columns: ["postId", "parentId"],
      }),
      this.createIndex({
        schema: "public",
        table: "comments",
        index: "comments_postId_rootId_createdAt_idx",
        columns: ["postId", "rootId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "communities",
        index: "communities_createdAt_idx",
        columns: ["createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "communities",
        index: "communities_description_trgm_idx_a7d2a019",
        expression: "description gin_trgm_ops",
        extras: { type: "gin" },
      }),
      this.createIndex({
        schema: "public",
        table: "communities",
        index: "communities_name_trgm_idx_0595b3e0",
        expression: "name gin_trgm_ops",
        extras: { type: "gin" },
      }),
      this.createIndex({
        schema: "public",
        table: "communities",
        index: "communities_ownerId_idx",
        columns: ["ownerId"],
      }),
      this.createIndex({
        schema: "public",
        table: "communities",
        index: "communities_slug_trgm_idx_65e3b563",
        expression: "slug gin_trgm_ops",
        extras: { type: "gin" },
      }),
      this.createIndex({
        schema: "public",
        table: "communities",
        index: "communities_topics_idx",
        columns: ["topics"],
        extras: { type: "gin" },
      }),
      this.createIndex({
        schema: "public",
        table: "communities",
        index: "communities_type_idx",
        columns: ["type"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_join_bonuses",
        index: "community_join_bonuses_userId_createdAt_idx",
        columns: ["userId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_members",
        index: "community_members_communityId_role_idx",
        columns: ["communityId", "role"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_members",
        index: "community_members_communityId_status_idx",
        columns: ["communityId", "status"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_members",
        index: "community_members_userId_idx",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_members",
        index: "community_members_userId_status_createdAt_idx",
        columns: ["userId", "status", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_post_shares",
        index: "community_post_shares_communityId_idx",
        columns: ["communityId"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_post_shares",
        index: "community_post_shares_sourcePostId_idx",
        columns: ["sourcePostId"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_subscriptions",
        index: "community_subscriptions_communityId_idx",
        columns: ["communityId"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_subscriptions",
        index: "community_subscriptions_userId_createdAt_idx",
        columns: ["userId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_visits",
        index: "community_visits_communityId_visitedAt_idx",
        columns: ["communityId", "visitedAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "community_visits",
        index: "community_visits_userId_visitedAt_idx",
        columns: ["userId", "visitedAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "device_push_tokens",
        index: "device_push_tokens_userId_idx",
        columns: ["userId"],
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
        table: "follows",
        index: "follows_followingId_idx",
        columns: ["followingId"],
      }),
      this.createIndex({
        schema: "public",
        table: "mentions",
        index: "mentions_userId_idx",
        columns: ["userId"],
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
        index: "message_conversation_keys_conversationId_ownerUserId_idx",
        columns: ["conversationId", "ownerUserId"],
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
        table: "message_conversation_members",
        index: "message_conversation_members_userId_idx",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_members",
        index: "message_conversation_members_userId_mutedAt_idx",
        columns: ["userId", "mutedAt"],
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
        table: "message_hidden",
        index: "message_hidden_userId_idx",
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
        table: "messages",
        index: "messages_conversationId_createdAt_idx",
        columns: ["conversationId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "messages",
        index: "messages_conversationId_id_idx",
        columns: ["conversationId", "id"],
      }),
      this.createIndex({
        schema: "public",
        table: "messages",
        index: "messages_senderId_idx",
        columns: ["senderId"],
      }),
      this.createIndex({
        schema: "public",
        table: "notifications",
        index: "notifications_commentId_idx",
        columns: ["commentId"],
      }),
      this.createIndex({
        schema: "public",
        table: "notifications",
        index: "notifications_issuerId_type_createdAt_idx",
        columns: ["issuerId", "type", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "notifications",
        index: "notifications_recipientId_communityId_type_read_idx",
        columns: ["recipientId", "communityId", "type", "read"],
      }),
      this.createIndex({
        schema: "public",
        table: "notifications",
        index: "notifications_recipientId_conversationId_type_read_idx",
        columns: ["recipientId", "conversationId", "type", "read"],
      }),
      this.createIndex({
        schema: "public",
        table: "notifications",
        index: "notifications_recipientId_createdAt_idx",
        columns: ["recipientId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "notifications",
        index: "notifications_recipientId_read_idx",
        columns: ["recipientId", "read"],
      }),
      this.createIndex({
        schema: "public",
        table: "passkey",
        index: "passkey_userId_idx",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "password_reset_tokens",
        index: "password_reset_tokens_token_idx",
        columns: ["token"],
      }),
      this.createIndex({
        schema: "public",
        table: "post_media",
        index: "post_media_commentId_idx",
        columns: ["commentId"],
      }),
      this.createIndex({
        schema: "public",
        table: "post_media",
        index: "post_media_duplicateOf_idx",
        columns: ["duplicateOf"],
      }),
      this.createIndex({
        schema: "public",
        table: "post_media",
        index: "post_media_messageConversationId_idx",
        columns: ["messageConversationId"],
      }),
      this.createIndex({
        schema: "public",
        table: "post_media",
        index: "post_media_originalProvenanceId_idx",
        columns: ["originalProvenanceId"],
      }),
      this.createIndex({
        schema: "public",
        table: "post_media",
        index: "post_media_phash_idx",
        columns: ["phash"],
      }),
      this.createIndex({
        schema: "public",
        table: "post_media",
        index: "post_media_postId_idx",
        columns: ["postId"],
      }),
      this.createIndex({
        schema: "public",
        table: "post_media",
        index: "post_media_reShareChecked_idx",
        columns: ["reShareChecked"],
      }),
      this.createIndex({
        schema: "public",
        table: "post_media",
        index: "post_media_sha256_idx",
        columns: ["sha256"],
      }),
      this.createIndex({
        schema: "public",
        table: "post_media",
        index: "post_media_status_idx",
        columns: ["status"],
      }),
      this.createIndex({
        schema: "public",
        table: "post_media",
        index: "post_media_userId_createdAt_idx",
        columns: ["userId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "post_media_derivatives",
        index: "post_media_derivatives_key_idx",
        columns: ["key"],
      }),
      this.createIndex({
        schema: "public",
        table: "post_visits",
        index: "post_visits_postId_idx",
        columns: ["postId"],
      }),
      this.createIndex({
        schema: "public",
        table: "post_visits",
        index: "post_visits_userId_visitedAt_idx",
        columns: ["userId", "visitedAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "posts",
        index: "posts_communityId_aura_idx",
        columns: ["communityId", "aura"],
      }),
      this.createIndex({
        schema: "public",
        table: "posts",
        index: "posts_communityId_createdAt_idx",
        columns: ["communityId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "posts",
        index: "posts_content_trgm_idx_08ad1c7c",
        expression: "content gin_trgm_ops",
        extras: { type: "gin" },
      }),
      this.createIndex({
        schema: "public",
        table: "posts",
        index: "posts_externalParentId_idx_23c1048b",
        columns: ["externalParentId"],
      }),
      this.createIndex({
        schema: "public",
        table: "posts",
        index: "posts_isGust_aura_id_idx",
        columns: ["isGust", "aura", "id"],
      }),
      this.createIndex({
        schema: "public",
        table: "posts",
        index: "posts_isGust_createdAt_idx",
        columns: ["isGust", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "posts",
        index: "posts_isGust_trendingScore_id_idx",
        columns: ["isGust", "trendingScore", "id"],
      }),
      this.createIndex({
        schema: "public",
        table: "posts",
        index: "posts_parentPostId_createdAt_idx",
        columns: ["parentPostId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "posts",
        index: "posts_rootPostId_createdAt_idx",
        columns: ["rootPostId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "posts",
        index: "posts_threadTopId_createdAt_idx",
        columns: ["threadTopId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "posts",
        index: "posts_userId_isGust_createdAt_idx",
        columns: ["userId", "isGust", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "push_subscriptions",
        index: "push_subscriptions_userId_idx",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "recommendation_events",
        index: "recommendation_events_postId_eventType_createdAt_idx",
        columns: ["postId", "eventType", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "recommendation_events",
        index: "recommendation_events_userId_eventType_createdAt_idx",
        columns: ["userId", "eventType", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "recommendation_events",
        index: "recommendation_events_userId_postId_createdAt_idx",
        columns: ["userId", "postId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "twoFactor",
        index: "twoFactor_secret_idx",
        columns: ["secret"],
      }),
      this.createIndex({
        schema: "public",
        table: "username_aliases",
        index: "username_aliases_expiresAt_idx",
        columns: ["expiresAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "username_aliases",
        index: "username_aliases_userId_createdAt_idx",
        columns: ["userId", "createdAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "username_aliases",
        index: "username_aliases_username_trgm_idx_c97ac12d",
        expression: "username gin_trgm_ops",
        extras: { type: "gin" },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_admin_role_unique_184af61f",
        columns: ["role"],
        extras: { where: "(role = 'admin'::text)", unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_aura_idx",
        columns: ["aura"],
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_author_array_unique_4a2e2c3b",
        expression:
          "(\nCASE\n    WHEN 'author'::text = ANY (badges) THEN 'author'::text\n    ELSE NULL::text\nEND)",
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_author_badge_unique_c0deed9d",
        columns: ["badge"],
        extras: { where: "(badge = 'author'::text)", unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_badges_idx",
        columns: ["badges"],
        extras: { type: "gin" },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_banExpires_idx",
        columns: ["banExpires"],
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_banned_idx",
        columns: ["banned"],
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_display_name_trgm_idx_c493f926",
        expression: '"displayName" gin_trgm_ops',
        extras: { type: "gin" },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_display_username_trgm_idx_ce7120c2",
        expression: '"displayUsername" gin_trgm_ops',
        extras: { type: "gin" },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_username_lower_unique_4babe768",
        expression: "lower(username)",
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_username_trgm_idx_c97ac12d",
        expression: "username gin_trgm_ops",
        extras: { type: "gin" },
      }),
      this.createIndex({
        schema: "public",
        table: "verification",
        index: "verification_expiresAt_idx",
        columns: ["expiresAt"],
      }),
      this.createIndex({
        schema: "public",
        table: "verification",
        index: "verification_identifier_idx",
        columns: ["identifier"],
      }),
      this.createIndex({
        schema: "public",
        table: "votes",
        index: "votes_postId_idx",
        columns: ["postId"],
      }),
      this.createIndex({
        schema: "public",
        table: "votes",
        index: "votes_userId_value_createdAt_idx",
        columns: ["userId", "value", "createdAt"],
      }),
      this.addForeignKey({
        schema: "public",
        table: "HNBookmark",
        foreignKey: {
          name: "HNBookmark_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "_PostToTag",
        foreignKey: {
          name: "_PostToTag_A_fkey",
          columns: ["A"],
          references: { schema: "public", table: "posts", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "_PostToTag",
        foreignKey: {
          name: "_PostToTag_B_fkey",
          columns: ["B"],
          references: { schema: "public", table: "Tag", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "accounts",
        foreignKey: {
          name: "accounts_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "aura_logs",
        foreignKey: {
          name: "aura_logs_commentId_fkey",
          columns: ["commentId"],
          references: { schema: "public", table: "comments", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "aura_logs",
        foreignKey: {
          name: "aura_logs_issuerId_fkey",
          columns: ["issuerId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "aura_logs",
        foreignKey: {
          name: "aura_logs_postId_fkey",
          columns: ["postId"],
          references: { schema: "public", table: "posts", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "aura_logs",
        foreignKey: {
          name: "aura_logs_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "blocks",
        foreignKey: {
          name: "blocks_blockedId_fkey",
          columns: ["blockedId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "blocks",
        foreignKey: {
          name: "blocks_blockerId_fkey",
          columns: ["blockerId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "bookmarks",
        foreignKey: {
          name: "bookmarks_postId_fkey",
          columns: ["postId"],
          references: { schema: "public", table: "posts", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "bookmarks",
        foreignKey: {
          name: "bookmarks_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "comment_votes",
        foreignKey: {
          name: "comment_votes_commentId_fkey",
          columns: ["commentId"],
          references: { schema: "public", table: "comments", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "comment_votes",
        foreignKey: {
          name: "comment_votes_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "comments",
        foreignKey: {
          name: "comments_parentId_fkey",
          columns: ["parentId"],
          references: { schema: "public", table: "comments", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "comments",
        foreignKey: {
          name: "comments_postId_fkey",
          columns: ["postId"],
          references: { schema: "public", table: "posts", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "comments",
        foreignKey: {
          name: "comments_rootId_fkey",
          columns: ["rootId"],
          references: { schema: "public", table: "comments", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "comments",
        foreignKey: {
          name: "comments_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "communities",
        foreignKey: {
          name: "communities_avatarMediaId_fkey",
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
        table: "communities",
        foreignKey: {
          name: "communities_bannerMediaId_fkey",
          columns: ["bannerMediaId"],
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
        table: "communities",
        foreignKey: {
          name: "communities_ownerId_fkey",
          columns: ["ownerId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_join_bonuses",
        foreignKey: {
          name: "community_join_bonuses_communityId_fkey",
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
        table: "community_join_bonuses",
        foreignKey: {
          name: "community_join_bonuses_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_members",
        foreignKey: {
          name: "community_members_communityId_fkey",
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
        table: "community_members",
        foreignKey: {
          name: "community_members_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_post_shares",
        foreignKey: {
          name: "community_post_shares_communityId_fkey",
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
        table: "community_post_shares",
        foreignKey: {
          name: "community_post_shares_postId_fkey",
          columns: ["postId"],
          references: { schema: "public", table: "posts", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_post_shares",
        foreignKey: {
          name: "community_post_shares_sourcePostId_fkey",
          columns: ["sourcePostId"],
          references: { schema: "public", table: "posts", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_subscriptions",
        foreignKey: {
          name: "community_subscriptions_communityId_fkey",
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
        table: "community_subscriptions",
        foreignKey: {
          name: "community_subscriptions_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "community_visits",
        foreignKey: {
          name: "community_visits_communityId_fkey",
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
        table: "community_visits",
        foreignKey: {
          name: "community_visits_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "device_push_tokens",
        foreignKey: {
          name: "device_push_tokens_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
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
        table: "follows",
        foreignKey: {
          name: "follows_followerId_fkey",
          columns: ["followerId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "follows",
        foreignKey: {
          name: "follows_followingId_fkey",
          columns: ["followingId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "hn_story_shares",
        foreignKey: {
          name: "hn_story_shares_postId_fkey",
          columns: ["postId"],
          references: { schema: "public", table: "posts", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "mentions",
        foreignKey: {
          name: "mentions_postId_fkey",
          columns: ["postId"],
          references: { schema: "public", table: "posts", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "mentions",
        foreignKey: {
          name: "mentions_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
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
        table: "message_conversation_keys",
        foreignKey: {
          name: "message_conversation_keys_conversationId_fkey",
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
          name: "message_conversation_keys_ownerUserId_fkey",
          columns: ["ownerUserId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_conversation_members",
        foreignKey: {
          name: "message_conversation_members_conversationId_fkey",
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
        table: "message_conversation_members",
        foreignKey: {
          name: "message_conversation_members_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
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
        table: "message_hidden",
        foreignKey: {
          name: "message_hidden_messageId_fkey",
          columns: ["messageId"],
          references: { schema: "public", table: "messages", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_hidden",
        foreignKey: {
          name: "message_hidden_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "message_identities",
        foreignKey: {
          name: "message_identities_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
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
        table: "messages",
        foreignKey: {
          name: "messages_conversationId_fkey",
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
        table: "messages",
        foreignKey: {
          name: "messages_senderId_fkey",
          columns: ["senderId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "notifications",
        foreignKey: {
          name: "notifications_commentId_fkey",
          columns: ["commentId"],
          references: { schema: "public", table: "comments", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "notifications",
        foreignKey: {
          name: "notifications_communityId_fkey",
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
      this.addForeignKey({
        schema: "public",
        table: "notifications",
        foreignKey: {
          name: "notifications_issuerId_fkey",
          columns: ["issuerId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "notifications",
        foreignKey: {
          name: "notifications_postId_fkey",
          columns: ["postId"],
          references: { schema: "public", table: "posts", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "notifications",
        foreignKey: {
          name: "notifications_recipientId_fkey",
          columns: ["recipientId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "passkey",
        foreignKey: {
          name: "passkey_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "password_reset_tokens",
        foreignKey: {
          name: "password_reset_tokens_userId_fkey",
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
          name: "post_media_audioOverlayId_fkey",
          columns: ["audioOverlayId"],
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
        table: "post_media",
        foreignKey: {
          name: "post_media_commentId_fkey",
          columns: ["commentId"],
          references: { schema: "public", table: "comments", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "post_media",
        foreignKey: {
          name: "post_media_messageConversationId_fkey",
          columns: ["messageConversationId"],
          references: {
            schema: "public",
            table: "message_conversations",
            columns: ["id"],
          },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "post_media",
        foreignKey: {
          name: "post_media_postId_fkey",
          columns: ["postId"],
          references: { schema: "public", table: "posts", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "post_media_derivatives",
        foreignKey: {
          name: "post_media_derivatives_mediaId_fkey",
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
        table: "post_visits",
        foreignKey: {
          name: "post_visits_postId_fkey",
          columns: ["postId"],
          references: { schema: "public", table: "posts", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "post_visits",
        foreignKey: {
          name: "post_visits_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "posts",
        foreignKey: {
          name: "posts_communityId_fkey",
          columns: ["communityId"],
          references: {
            schema: "public",
            table: "communities",
            columns: ["id"],
          },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "posts",
        foreignKey: {
          name: "posts_parentPostId_fkey",
          columns: ["parentPostId"],
          references: { schema: "public", table: "posts", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
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
      this.addForeignKey({
        schema: "public",
        table: "posts",
        foreignKey: {
          name: "posts_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "push_subscriptions",
        foreignKey: {
          name: "push_subscriptions_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "recommendation_events",
        foreignKey: {
          name: "recommendation_events_postId_fkey",
          columns: ["postId"],
          references: { schema: "public", table: "posts", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "recommendation_events",
        foreignKey: {
          name: "recommendation_events_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "sessions",
        foreignKey: {
          name: "sessions_impersonatedBy_fkey",
          columns: ["impersonatedBy"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "setNull",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "sessions",
        foreignKey: {
          name: "sessions_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "share_stats",
        foreignKey: {
          name: "share_stats_postId_fkey",
          columns: ["postId"],
          references: { schema: "public", table: "posts", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "twoFactor",
        foreignKey: {
          name: "twoFactor_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "username_aliases",
        foreignKey: {
          name: "username_aliases_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "users",
        foreignKey: {
          name: "users_avatarMediaId_fkey",
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
        table: "users",
        foreignKey: {
          name: "users_bannerMediaId_fkey",
          columns: ["bannerMediaId"],
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
        table: "verification",
        foreignKey: {
          name: "verification_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "votes",
        foreignKey: {
          name: "votes_postId_fkey",
          columns: ["postId"],
          references: { schema: "public", table: "posts", columns: ["id"] },
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      }),
      this.addForeignKey({
        schema: "public",
        table: "votes",
        foreignKey: {
          name: "votes_userId_fkey",
          columns: ["userId"],
          references: { schema: "public", table: "users", columns: ["id"] },
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
