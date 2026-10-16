import { createHash, randomUUID } from "node:crypto";

import { rawExecute, rawQuery } from "../messages/infrastructure/raw-sql";
import { renderSql } from "../messages/infrastructure/sql-template";
import prisma from "../prisma";
import type { PrismaTransaction } from "../prisma";
// oxlint-disable eslint/no-await-in-loop -- Transfers share one transaction and depend on the preceding deduplication.
import { accountResolutionSql } from "./account-resolution-queries";
import {
  deleteAccountResolutionState,
  readAccountResolutionState,
} from "./account-resolution-state";

export class AccountResolutionError extends Error {
  override name = "AccountResolutionError";
}

export async function accountCredentialFingerprint(
  userId: string,
  transaction?: PrismaTransaction
) {
  const { rows } = await rawQuery<{ fingerprint: string }>(
    accountResolutionSql.resolution.fingerprint,
    [userId],
    { fingerprint: "pg/text@1" },
    transaction
  );
  const value = rows[0]?.fingerprint;
  return value ? createHash("sha256").update(value).digest("hex") : null;
}

export async function accountResolutionSummary(
  userId: string,
  transaction?: PrismaTransaction
) {
  const { rows } = await rawQuery<{
    posts: number;
    comments: number;
    communities: number;
    privateHistory: boolean;
    ownsDen: boolean;
  }>(
    accountResolutionSql.resolution.summary,
    [userId],
    {
      comments: "pg/int4@1",
      communities: "pg/int4@1",
      ownsDen: "pg/bool@1",
      posts: "pg/int4@1",
      privateHistory: "pg/bool@1",
    },
    transaction
  );
  const [row] = rows;
  if (!row) {
    throw new AccountResolutionError("Could not review account content.");
  }
  return row;
}

// These identifiers are application constants, never request input.
const uniqueRelations = [
  ["bookmarks", "postId"],
  ["comment_votes", "commentId"],
  ["votes", "postId"],
  ["community_join_bonuses", "communityId"],
  ["community_members", "communityId"],
  ["community_subscriptions", "communityId"],
  ["community_visits", "communityId"],
  ["HNBookmark", "storyId"],
  ["mentions", "postId"],
  ["post_visits", "postId"],
] as const;

async function transferPublicContent(
  source: string,
  target: string,
  transaction: PrismaTransaction
) {
  const values = [source, target];
  // Preserve pending approval and the stronger role when both memberships exist.
  await rawExecute(
    accountResolutionSql.resolution.preserveMembershipStatus,
    values,
    transaction
  );
  await rawExecute(
    accountResolutionSql.resolution.preserveMembershipRole,
    values,
    transaction
  );
  for (const [table, key] of uniqueRelations) {
    await rawExecute(
      renderSql(accountResolutionSql.resolution.deduplicateRelation, {
        key,
        table,
      }),
      values,
      transaction
    );
    await rawExecute(
      renderSql(accountResolutionSql.resolution.transferRelation, { table }),
      values,
      transaction
    );
  }
  await rawExecute(
    accountResolutionSql.resolution.transferCommunityOwnerRole,
    values,
    transaction
  );
  for (const [table, first, second] of [
    ["follows", "followerId", "followingId"],
    ["blocks", "blockerId", "blockedId"],
  ] as const) {
    await rawExecute(
      renderSql(accountResolutionSql.resolution.removeSelfRelation, {
        first,
        second,
        table,
      }),
      values,
      transaction
    );
    for (const [field, other] of [
      [first, second],
      [second, first],
    ]) {
      await rawExecute(
        renderSql(accountResolutionSql.resolution.deduplicateSocialRelation, {
          field,
          other,
          table,
        }),
        values,
        transaction
      );
      await rawExecute(
        renderSql(accountResolutionSql.resolution.transferSocialRelation, {
          field,
          table,
        }),
        values,
        transaction
      );
    }
  }
  for (const [table, field] of [
    ["posts", "userId"],
    ["comments", "userId"],
    ["post_media", "userId"],
    ["communities", "ownerId"],
    ["notifications", "issuerId"],
    ["notifications", "recipientId"],
    ["aura_logs", "userId"],
    ["aura_logs", "issuerId"],
    ["aura_logs", "targetUserId"],
    ["username_aliases", "userId"],
    ["recommendation_events", "userId"],
    ["message_conversation_members", "invitedById"],
    ["message_den_bans", "bannedById"],
    ["message_conversations", "createdById"],
    ["message_conversation_membership_events", "actorId"],
    ["message_conversation_membership_events", "targetUserId"],
  ] as const) {
    await rawExecute(
      renderSql(accountResolutionSql.resolution.transferContentOwner, {
        field,
        table,
      }),
      values,
      transaction
    );
  }
  await rawExecute(
    accountResolutionSql.resolution.combineAura,
    values,
    transaction
  );
  // Refuse future or unsupported relations instead of silently cascading away content.
  const { rows: references } = await rawQuery<{
    tableName: string;
    columnName: string;
  }>(
    accountResolutionSql.resolution.userReferences,
    [],
    { columnName: "pg/text@1", tableName: "pg/text@1" },
    transaction
  );
  const retiredAuthTables = new Set([
    "accounts",
    "sessions",
    "verification",
    "twoFactor",
    "passkey",
    "password_reset_tokens",
    "device_push_tokens",
    "push_subscriptions",
    "message_identities",
  ]);
  for (const reference of references) {
    if (retiredAuthTables.has(reference.tableName)) {
      continue;
    }
    const table = reference.tableName.replaceAll('"', '""');
    const column = reference.columnName.replaceAll('"', '""');
    const remaining = await rawQuery<{ present: boolean }>(
      renderSql(accountResolutionSql.resolution.remainingReference, {
        column,
        table,
      }),
      [source],
      { present: "pg/bool@1" },
      transaction
    );
    if (remaining.rows[0]?.present) {
      throw new AccountResolutionError(
        "This account contains records that cannot yet be transferred safely. Keep this profile instead, or cancel."
      );
    }
  }
}

export interface ResolveAccountCollisionInput {
  id: string;
  expectedState: string;
  currentUserId: string;
  sessionId: string;
  otherUserId: string;
  keepUserId: string;
  mode: "merge" | "discard";
  confirmation: string;
  fingerprints: Record<string, string>;
  provider?: { id: string; accountId: string; expectedOwner?: string | null };
}

export function resolveAccountCollision(input: ResolveAccountCollisionInput) {
  return prisma.transaction(async (transaction) => {
    await rawExecute(
      accountResolutionSql.resolution.lockTimeout,
      [],
      transaction
    );
    const state = await readAccountResolutionState(input.id, transaction);
    if (!state || state !== input.expectedState) {
      throw new AccountResolutionError(
        "This review changed or expired. Start again."
      );
    }
    const ids = [input.currentUserId, input.otherUserId].toSorted();
    if (ids[0] === ids[1] || !ids.includes(input.keepUserId)) {
      throw new AccountResolutionError("Invalid account selection.");
    }
    await rawQuery<{ id: string }>(
      accountResolutionSql.resolution.lockUsers,
      ids,
      { id: "pg/text@1" },
      transaction
    );
    await rawQuery<{ id: string }>(
      accountResolutionSql.resolution.lockAccounts,
      ids,
      { id: "pg/text@1" },
      transaction
    );
    await rawQuery<{ id: string }>(
      accountResolutionSql.resolution.lockTwoFactor,
      ids,
      { id: "pg/text@1" },
      transaction
    );
    const active = await transaction.orm.public.Sessions.where({
      id: input.sessionId,
      userId: input.currentUserId,
    }).first();
    if (!active) {
      throw new AccountResolutionError(
        "Your session ended. Sign in and start again."
      );
    }
    const source = ids.find((id) => id !== input.keepUserId);
    if (!source) {
      throw new AccountResolutionError("Invalid account selection.");
    }
    for (const id of ids) {
      if (
        (await accountCredentialFingerprint(id, transaction)) !==
        input.fingerprints[id]
      ) {
        throw new AccountResolutionError(
          "An account's sign-in details changed. Verify both accounts again."
        );
      }
      const user = await transaction.orm.public.Users.where({ id }).first();
      const password = await transaction.orm.public.Accounts.where({
        accountId: id,
        providerId: "credential",
        userId: id,
      }).first();
      if (
        !user?.emailVerified ||
        !user.email ||
        !password?.password ||
        user.banned
      ) {
        throw new AccountResolutionError(
          "Both accounts need a verified email, password, and unrestricted access."
        );
      }
      if (
        id === source &&
        (user.role !== "user" ||
          user.badge === "author" ||
          user.badges?.includes("author"))
      ) {
        throw new AccountResolutionError(
          "Keep the account with the author or administrative role."
        );
      }
    }
    const losing = await transaction.orm.public.Users.where({
      id: source,
    }).first();
    if (!losing || input.confirmation !== losing.username) {
      throw new AccountResolutionError(
        "Type the exact username of the account being retired."
      );
    }
    if (input.provider) {
      const binding = await transaction.orm.public.Accounts.where({
        accountId: input.provider.accountId,
        providerId: input.provider.id,
      }).first();
      const expectedOwner =
        input.provider.expectedOwner === undefined
          ? input.otherUserId
          : input.provider.expectedOwner;
      if ((binding?.userId ?? null) !== expectedOwner) {
        throw new AccountResolutionError(
          "The provider account changed. Connect it again."
        );
      }
    }
    const summary = await accountResolutionSummary(source, transaction);
    if (summary.ownsDen) {
      throw new AccountResolutionError(
        "Transfer ownership of your dens before retiring this account."
      );
    }
    if (input.mode === "merge" && summary.privateHistory) {
      throw new AccountResolutionError(
        "This account has encrypted conversations that cannot be transferred safely. Keep this account instead, or cancel."
      );
    }
    if (input.mode === "discard" && summary.communities) {
      throw new AccountResolutionError(
        "Transfer your communities before deleting this account's content."
      );
    }
    // Credentials, passkeys and 2FA remain those of the chosen profile. Only OAuth identities move.
    await rawExecute(
      accountResolutionSql.resolution.transferOAuth,
      [source, input.keepUserId],
      transaction
    );
    if (input.provider?.expectedOwner === null) {
      await transaction.orm.public.Accounts.create({
        accountId: input.provider.accountId,
        providerId: input.provider.id,
        userId: input.keepUserId,
      });
    }
    if (input.mode === "merge") {
      await transferPublicContent(source, input.keepUserId, transaction);
    }
    // Clear unique legacy mirrors before choosing a provider identity for the surviving profile.
    await rawExecute(
      accountResolutionSql.resolution.clearProviderMirrors,
      [source],
      transaction
    );
    for (const [provider, field] of [
      ["google", "googleId"],
      ["reddit", "redditId"],
    ] as const) {
      await rawExecute(
        renderSql(accountResolutionSql.resolution.refreshProviderMirror, {
          field,
        }),
        [input.keepUserId, provider],
        transaction
      );
    }
    // Consume first; deleting either user must never leave a replayable resolution behind.
    await deleteAccountResolutionState(input.id, transaction);
    await rawExecute(
      accountResolutionSql.resolution.revokeSessions,
      ids,
      transaction
    );
    await rawExecute(
      accountResolutionSql.resolution.revokeVerifications,
      ids,
      transaction
    );
    await rawExecute(
      accountResolutionSql.resolution.retireUser,
      [source],
      transaction
    );
    if (input.mode === "merge") {
      await rawExecute(
        accountResolutionSql.resolution.reserveUsername,
        [randomUUID(), input.keepUserId, losing.username],
        transaction
      );
    }
    return { userId: input.keepUserId };
  });
}
