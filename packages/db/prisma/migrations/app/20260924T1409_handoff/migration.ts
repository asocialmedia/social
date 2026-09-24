#!/usr/bin/env -S node
import { Migration, MigrationCLI } from "@prisma/orm-postgres/migration";
import type { Migration as MigrationType } from "@prisma/orm-postgres/migration";

import type { Contract as Start } from "../../snapshots/02a928fd5ae3667e18aae17971a6d4552672bd7cc3c3141e2ea654c4f37506f1/contract";
import startContract from "../../snapshots/02a928fd5ae3667e18aae17971a6d4552672bd7cc3c3141e2ea654c4f37506f1/contract.json" with { type: "json" };
import type { Contract as End } from "../../snapshots/b7f48b2b25ac8bd86636ba789cfdd29ff29d79ae7d69e84bc124b5bdc8008be0/contract";
import endContract from "../../snapshots/b7f48b2b25ac8bd86636ba789cfdd29ff29d79ae7d69e84bc124b5bdc8008be0/contract.json" with { type: "json" };

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations(): MigrationType<Start, End>["operations"] {
    return [
      this.dropIndex({
        schema: "public",
        table: "HNBookmark",
        index: "HNBookmark_userId_storyId_key",
      }),
      this.dropIndex({ schema: "public", table: "Tag", index: "Tag_name_key" }),
      this.dropIndex({
        schema: "public",
        table: "accounts",
        index: "accounts_providerId_accountId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "bookmarks",
        index: "bookmarks_userId_postId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "comment_votes",
        index: "comment_votes_userId_commentId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "communities",
        index: "communities_avatarMediaId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "communities",
        index: "communities_bannerMediaId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "communities",
        index: "communities_slug_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "community_join_bonuses",
        index: "community_join_bonuses_communityId_userId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "community_members",
        index: "community_members_communityId_userId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "community_post_shares",
        index: "community_post_shares_postId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "community_subscriptions",
        index: "community_subscriptions_communityId_userId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "community_visits",
        index: "community_visits_communityId_userId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "device_push_tokens",
        index: "device_push_tokens_token_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "follows",
        index: "follows_followerId_followingId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "hn_story_shares",
        index: "hn_story_shares_postId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "mentions",
        index: "mentions_postId_userId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "message_conversation_keys",
        index: "message_conversation_keys_conversationId_ownerUserId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "message_conversations",
        index: "message_conversations_pairKey_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "messages",
        index: "messages_conversationId_senderId_ratchetIndex_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "passkey",
        index: "passkey_credentialID_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "password_reset_tokens",
        index: "password_reset_tokens_token_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "post_media",
        index: "post_media_audioOverlayId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "post_media_derivatives",
        index: "post_media_derivatives_mediaId_kind_variant_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "post_visits",
        index: "post_visits_userId_postId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "push_subscriptions",
        index: "push_subscriptions_endpoint_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "recommendation_events",
        index: "recommendation_events_dedupeKey_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "sessions",
        index: "sessions_token_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "share_stats",
        index: "share_stats_postId_platform_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "twoFactor",
        index: "twoFactor_userId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "username_aliases",
        index: "username_aliases_username_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "users",
        index: "users_avatarMediaId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "users",
        index: "users_bannerMediaId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "users",
        index: "users_discordId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "users",
        index: "users_email_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "users",
        index: "users_githubId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "users",
        index: "users_googleId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "users",
        index: "users_redditId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "users",
        index: "users_twitterId_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "users",
        index: "users_username_key",
      }),
      this.dropIndex({
        schema: "public",
        table: "votes",
        index: "votes_userId_postId_key",
      }),
      this.setDefault({
        schema: "public",
        table: "Tag",
        column: "updatedAt",
        defaultSql: "DEFAULT (now())",
      }),
      this.setDefault({
        schema: "public",
        table: "accounts",
        column: "updatedAt",
        defaultSql: "DEFAULT (now())",
      }),
      this.setDefault({
        schema: "public",
        table: "communities",
        column: "updatedAt",
        defaultSql: "DEFAULT (now())",
      }),
      this.setDefault({
        schema: "public",
        table: "device_push_tokens",
        column: "updatedAt",
        defaultSql: "DEFAULT (now())",
      }),
      this.setDefault({
        schema: "public",
        table: "jwks",
        column: "updatedAt",
        defaultSql: "DEFAULT (now())",
      }),
      this.setDefault({
        schema: "public",
        table: "message_conversations",
        column: "updatedAt",
        defaultSql: "DEFAULT (now())",
      }),
      this.setDefault({
        schema: "public",
        table: "message_identities",
        column: "updatedAt",
        defaultSql: "DEFAULT (now())",
      }),
      this.setDefault({
        schema: "public",
        table: "post_media",
        column: "updatedAt",
        defaultSql: "DEFAULT (now())",
      }),
      this.setDefault({
        schema: "public",
        table: "push_subscriptions",
        column: "updatedAt",
        defaultSql: "DEFAULT (now())",
      }),
      this.setDefault({
        schema: "public",
        table: "sessions",
        column: "updatedAt",
        defaultSql: "DEFAULT (now())",
      }),
      this.setDefault({
        schema: "public",
        table: "share_stats",
        column: "updatedAt",
        defaultSql: "DEFAULT (now())",
      }),
      this.setDefault({
        schema: "public",
        table: "twoFactor",
        column: "updatedAt",
        defaultSql: "DEFAULT (now())",
      }),
      this.setDefault({
        schema: "public",
        table: "users",
        column: "updatedAt",
        defaultSql: "DEFAULT (now())",
      }),
      this.setDefault({
        schema: "public",
        table: "verification",
        column: "updatedAt",
        defaultSql: "DEFAULT (now())",
      }),
      this.addPrimaryKey({
        schema: "public",
        table: "comment_votes",
        constraint: "comment_votes_pkey",
        columns: ["userId", "commentId"],
      }),
      this.addPrimaryKey({
        schema: "public",
        table: "follows",
        constraint: "follows_pkey",
        columns: ["followerId", "followingId"],
      }),
      this.addPrimaryKey({
        schema: "public",
        table: "votes",
        constraint: "votes_pkey",
        columns: ["userId", "postId"],
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
        table: "message_conversation_keys",
        constraint: "message_conversation_keys_conversationId_ownerUserId_key",
        columns: ["conversationId", "ownerUserId"],
      }),
      this.addUnique({
        schema: "public",
        table: "message_conversations",
        constraint: "message_conversations_pairKey_key",
        columns: ["pairKey"],
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
      this.renameIndex({
        schema: "public",
        table: "users",
        from: "users_admin_role_unique",
        to: "users_admin_role_unique_184af61f",
      }),
      this.renameIndex({
        schema: "public",
        table: "users",
        from: "users_author_array_unique",
        to: "users_author_array_unique_4a2e2c3b",
      }),
      this.renameIndex({
        schema: "public",
        table: "users",
        from: "users_author_badge_unique",
        to: "users_author_badge_unique_c0deed9d",
      }),
      this.renameIndex({
        schema: "public",
        table: "users",
        from: "users_username_lower_unique",
        to: "users_username_lower_unique_4babe768",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
