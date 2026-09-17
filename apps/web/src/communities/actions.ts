"use server";

import { createCommunitySchema } from "@asm/auth/validation";
import {
  approveMember as approveMemberService,
  CommunityError,
  consumeRateLimit,
  createCommunity as createCommunityService,
  getCommunityCreationQuota,
  invalidateCommunityStats,
  joinCommunity as joinCommunityService,
  leaveCommunity as leaveCommunityService,
  setMemberRole as setMemberRoleService,
} from "@asm/db";
import type { CommunityCreationQuota, CommunityData } from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";

const logger = createLogger({ serviceName: "community-actions" });

function requireUser(userId: string | undefined): string {
  if (!userId) {
    throw new Error("Sign in to do that");
  }
  return userId;
}

// Creation spam is the most expensive abuse a single account can mount here
// (each create writes a community, a membership and an aura award), and the
// server action bypasses the /api edge guard entirely. Two Redis-backed caps
// bound it: a burst window and a daily ceiling. Both fail open when Redis is
// down, matching the rest of the rate limiting in the app.
const CREATE_BURST = {
  bucket: "community-create",
  limit: 3,
  windowSeconds: 600,
};
const CREATE_DAILY = {
  bucket: "community-create-daily",
  limit: 10,
  windowSeconds: 86_400,
};

async function assertCreationRate(userId: string): Promise<void> {
  const [burst, daily] = await Promise.all([
    consumeRateLimit({ ...CREATE_BURST, identifier: userId }),
    consumeRateLimit({ ...CREATE_DAILY, identifier: userId }),
  ]);
  if (!burst.allowed || !daily.allowed) {
    throw new Error(
      "You're creating communities too quickly. Try again a little later."
    );
  }
}

// Creates a community from the wizard payload. The creator becomes the OWNER
// and the first ACTIVE member; slug/name/topic/accent validation happens in the
// service so the API route and any future surface share one set of rules.
export async function createCommunity(input: unknown): Promise<CommunityData> {
  const session = await getSessionFromApi();
  const userId = requireUser(session?.user?.id);

  await assertCreationRate(userId);

  const parsed = createCommunitySchema.parse(input);
  try {
    return await createCommunityService({
      ...parsed,
      ownerId: userId,
    });
  } catch (error) {
    if (error instanceof CommunityError) {
      throw new TypeError(error.message, { cause: error });
    }
    logger.error({ error: String(error), userId }, "community create failed");
    throw new Error("Couldn't create that community, try again?", {
      cause: error,
    });
  }
}

// The wizard reads this on open so the aura/ownership gate is shown up front
// instead of surfacing as a failed submit at the end of the flow. The server
// still re-checks the same rule atomically at write time.
export async function communityCreationQuota(): Promise<CommunityCreationQuota> {
  const session = await getSessionFromApi();
  const userId = requireUser(session?.user?.id);
  return getCommunityCreationQuota(userId);
}

export async function joinCommunity(
  communityId: string
): Promise<{ status: "ACTIVE" | "PENDING" }> {
  const session = await getSessionFromApi();
  const userId = requireUser(session?.user?.id);
  return joinCommunityService(communityId, userId);
}

export async function leaveCommunity(communityId: string): Promise<void> {
  const session = await getSessionFromApi();
  const userId = requireUser(session?.user?.id);
  await leaveCommunityService(communityId, userId);
}

export async function approveMember(
  communityId: string,
  targetUserId: string
): Promise<void> {
  const session = await getSessionFromApi();
  const actorId = requireUser(session?.user?.id);
  await approveMemberService(communityId, actorId, targetUserId);
}

export async function setMemberRole(
  communityId: string,
  targetUserId: string,
  role: "MODERATOR" | "MEMBER"
): Promise<void> {
  const session = await getSessionFromApi();
  const actorId = requireUser(session?.user?.id);
  await setMemberRoleService(communityId, actorId, targetUserId, role);
}

// Records a community page view. One row per (community, viewer), refreshed on
// each visit; the sidebar's weekly visitor count reads this rolling window.
export async function recordCommunityVisit(communityId: string): Promise<void> {
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  // Guests do not produce visitor rows (communities have no guest identity).
  if (!userId) {
    return;
  }
  const { recordCommunityVisit: record } = await import("@asm/db");
  await record(communityId, userId);
}

// A community post changes the community's aggregate aura; the detail page
// calls this after publishing so the sidebar refreshes immediately.
export async function refreshCommunityStats(
  communityId: string
): Promise<void> {
  await invalidateCommunityStats(communityId);
}
