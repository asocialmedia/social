import source from "../../sql/users/account-resolution.sql" with { type: "text" };
import { readSqlBundle } from "../messages/infrastructure/sql-template";

export const accountResolutionSql = readSqlBundle(source, {
  resolution: [
    "fingerprint",
    "summary",
    "preserveMembershipStatus",
    "preserveMembershipRole",
    "deduplicateRelation",
    "transferRelation",
    "transferCommunityOwnerRole",
    "removeSelfRelation",
    "deduplicateSocialRelation",
    "transferSocialRelation",
    "transferContentOwner",
    "combineAura",
    "userReferences",
    "remainingReference",
    "lockTimeout",
    "lockUsers",
    "lockAccounts",
    "lockTwoFactor",
    "transferOAuth",
    "clearProviderMirrors",
    "refreshProviderMirror",
    "revokeSessions",
    "revokeVerifications",
    "retireUser",
    "reserveUsername",
  ],
  state: ["read", "update", "delete"],
} as const);
