#!/usr/bin/env -S node
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
} from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as End } from "../../snapshots/095080b42c0e4a508cceacaabdb5fbcf86fe474ec8c63318070ecc8eadf375de/contract";
import endContract from "../../snapshots/095080b42c0e4a508cceacaabdb5fbcf86fe474ec8c63318070ecc8eadf375de/contract.json" with { type: "json" };

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<never, End>["operations"] {
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
        table: "backfill_markers",
        columns: [
          col("completed_at", "timestamp(3)", {
            notNull: true,
            default: fn("now()"),
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
          col("name", "text", {
            notNull: true,
            codecRef: { codecId: "pg/text@1" },
          }),
        ],
        constraints: [primaryKey(["name"], { name: "backfill_markers_pkey" })],
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
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
        ],
        constraints: [primaryKey(["id"], { name: "communities_pkey" })],
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
          col("lastReadAt", "timestamp(3)", {
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
          primaryKey(["conversationId", "userId"], {
            name: "message_conversation_members_pkey",
          }),
        ],
      }),
      this.createTable({
        schema: "public",
        table: "message_conversations",
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
          col("pairKey", "text", { codecRef: { codecId: "pg/text@1" } }),
          col("updatedAt", "timestamp(3)", {
            notNull: true,
            codecRef: {
              codecId: "pg/timestamp-temporal@1",
              typeParams: { precision: 3 },
            },
          }),
        ],
        constraints: [
          primaryKey(["id"], { name: "message_conversations_pkey" }),
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
          col("deletedAt", "timestamp(3)", {
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
          col("ratchetIndex", "int4", {
            notNull: true,
            default: lit(0),
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
        constraints: [primaryKey(["id"], { name: "post_media_pkey" })],
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
          col("embeds", "jsonb", { codecRef: { codecId: "pg/jsonb@1" } }),
          col("explicitContent", "bool", {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: "pg/bool@1" },
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
        constraints: [primaryKey(["id"], { name: "posts_pkey" })],
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
        constraints: [primaryKey(["id"], { name: "users_pkey" })],
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
        table: "HNBookmark",
        index: "HNBookmark_userId_storyId_key",
        columns: ["userId", "storyId"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "Tag",
        index: "Tag_name_key",
        columns: ["name"],
        extras: { unique: true },
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
        table: "accounts",
        index: "accounts_providerId_accountId_key",
        columns: ["providerId", "accountId"],
        extras: { unique: true },
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
        table: "bookmarks",
        index: "bookmarks_userId_postId_key",
        columns: ["userId", "postId"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "comment_votes",
        index: "comment_votes_commentId_value_idx",
        columns: ["commentId", "value"],
      }),
      this.createIndex({
        schema: "public",
        table: "comment_votes",
        index: "comment_votes_userId_commentId_key",
        columns: ["userId", "commentId"],
        extras: { unique: true },
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
        index: "communities_avatarMediaId_key",
        columns: ["avatarMediaId"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "communities",
        index: "communities_bannerMediaId_key",
        columns: ["bannerMediaId"],
        extras: { unique: true },
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
        index: "communities_ownerId_idx",
        columns: ["ownerId"],
      }),
      this.createIndex({
        schema: "public",
        table: "communities",
        index: "communities_slug_key",
        columns: ["slug"],
        extras: { unique: true },
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
        index: "community_join_bonuses_communityId_userId_key",
        columns: ["communityId", "userId"],
        extras: { unique: true },
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
        index: "community_members_communityId_userId_key",
        columns: ["communityId", "userId"],
        extras: { unique: true },
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
        index: "community_post_shares_postId_key",
        columns: ["postId"],
        extras: { unique: true },
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
        index: "community_subscriptions_communityId_userId_key",
        columns: ["communityId", "userId"],
        extras: { unique: true },
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
        index: "community_visits_communityId_userId_key",
        columns: ["communityId", "userId"],
        extras: { unique: true },
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
        table: "follows",
        index: "follows_followerId_followingId_key",
        columns: ["followerId", "followingId"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "follows",
        index: "follows_followingId_idx",
        columns: ["followingId"],
      }),
      this.createIndex({
        schema: "public",
        table: "hn_story_shares",
        index: "hn_story_shares_postId_key",
        columns: ["postId"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "mentions",
        index: "mentions_postId_userId_key",
        columns: ["postId", "userId"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "mentions",
        index: "mentions_userId_idx",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_keys",
        index: "message_conversation_keys_conversationId_ownerUserId_key",
        columns: ["conversationId", "ownerUserId"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversation_members",
        index: "message_conversation_members_userId_idx",
        columns: ["userId"],
      }),
      this.createIndex({
        schema: "public",
        table: "message_conversations",
        index: "message_conversations_pairKey_key",
        columns: ["pairKey"],
        extras: { unique: true },
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
        index: "messages_conversationId_senderId_ratchetIndex_key",
        columns: ["conversationId", "senderId", "ratchetIndex"],
        extras: { unique: true },
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
        index: "passkey_credentialID_key",
        columns: ["credentialID"],
        extras: { unique: true },
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
        table: "password_reset_tokens",
        index: "password_reset_tokens_token_key",
        columns: ["token"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "post_media",
        index: "post_media_audioOverlayId_key",
        columns: ["audioOverlayId"],
        extras: { unique: true },
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
        table: "post_media_derivatives",
        index: "post_media_derivatives_mediaId_kind_variant_key",
        columns: ["mediaId", "kind", "variant"],
        extras: { unique: true },
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
        index: "post_visits_userId_postId_key",
        columns: ["userId", "postId"],
        extras: { unique: true },
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
        table: "recommendation_events",
        index: "recommendation_events_dedupeKey_key",
        columns: ["dedupeKey"],
        extras: { unique: true },
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
        table: "sessions",
        index: "sessions_token_key",
        columns: ["token"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "share_stats",
        index: "share_stats_postId_platform_key",
        columns: ["postId", "platform"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "twoFactor",
        index: "twoFactor_secret_idx",
        columns: ["secret"],
      }),
      this.createIndex({
        schema: "public",
        table: "twoFactor",
        index: "twoFactor_userId_key",
        columns: ["userId"],
        extras: { unique: true },
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
        index: "username_aliases_username_key",
        columns: ["username"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_admin_role_unique",
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
        index: "users_author_array_unique",
        expression:
          "(\nCASE\n    WHEN 'author'::text = ANY (badges) THEN 'author'::text\n    ELSE NULL::text\nEND)",
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_author_badge_unique",
        columns: ["badge"],
        extras: { where: "(badge = 'author'::text)", unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_avatarMediaId_key",
        columns: ["avatarMediaId"],
        extras: { unique: true },
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
        index: "users_bannerMediaId_key",
        columns: ["bannerMediaId"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_discordId_key",
        columns: ["discordId"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_email_key",
        columns: ["email"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_githubId_key",
        columns: ["githubId"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_googleId_key",
        columns: ["googleId"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_redditId_key",
        columns: ["redditId"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_twitterId_key",
        columns: ["twitterId"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_username_key",
        columns: ["username"],
        extras: { unique: true },
      }),
      this.createIndex({
        schema: "public",
        table: "users",
        index: "users_username_lower_unique",
        expression: "lower(username)",
        extras: { unique: true },
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
        index: "votes_userId_postId_key",
        columns: ["userId", "postId"],
        extras: { unique: true },
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
          onDelete: "restrict",
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
          onDelete: "restrict",
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
          onDelete: "restrict",
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
          name: "posts_userId_fkey",
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
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
