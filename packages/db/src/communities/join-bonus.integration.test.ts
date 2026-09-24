import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import {
  COMMUNITY_JOIN_AURA,
  COMMUNITY_JOIN_DAILY_AURA_CAP,
  COMMUNITY_JOIN_MIN_ACCOUNT_AGE_DAYS,
  COMMUNITY_JOIN_OWNER_AURA,
  approveMember,
  createCommunity,
  joinCommunity,
  leaveCommunity,
  prisma,
  redis,
  toPrismaDateTime,
} from "@asm/db";
import { and, or } from "@prisma/orm-postgres/orm-client";

// Anti-farm coverage for the community join bonus. The whole feature is one
// expensive award per (community, user) pair, so these tests pin the guards
// that make it non-repeatable: the durable marker, the account-age gate, the
// daily ceiling, and the owner self-join exemption.

const RUN_ID =
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    .replaceAll("-", "_")
    .slice(0, 18);

const OWNER_ID = `jb-owner-${RUN_ID}`;
const MATURE_ID = `jb-mature-${RUN_ID}`;
const FRESH_ID = `jb-fresh-${RUN_ID}`;
const PUBLIC_SLUG = `jbp${RUN_ID}`;
const RESTRICTED_SLUG = `jbr${RUN_ID}`;

async function createUser(id: string, ageDays: number): Promise<void> {
  await prisma.orm.public.Users.create({
    createdAt: toPrismaDateTime(new Date(Date.now() - ageDays * 86_400_000)),
    displayName: id,
    email: `${id}@example.test`,
    id,
    username: id,
  });
}

async function auraOf(userId: string): Promise<number> {
  const user = await prisma.orm.public.Users.select("aura")
    .where((candidate) => candidate.id.eq(userId))
    .first();
  return user?.aura ?? 0;
}

async function joinedCommunityIds(userId: string): Promise<string[]> {
  const rows = await prisma.orm.public.CommunityMembers.select("communityId")
    .where((member) =>
      and(member.status.eq("ACTIVE"), member.userId.eq(userId))
    )
    .all();
  return rows.map((row) => row.communityId);
}

async function communityBySlug(
  slug: string
): Promise<{ id: string; ownerId: string }> {
  const community = await prisma.orm.public.Communities.select("id", "ownerId")
    .where((candidate) => candidate.slug.eq(slug))
    .first();
  if (!community) {
    throw new Error(`Community ${slug} missing`);
  }
  return community;
}

beforeAll(async () => {
  await createUser(OWNER_ID, 100);
  await createUser(MATURE_ID, 100);
  // Below COMMUNITY_JOIN_MIN_ACCOUNT_AGE_DAYS on purpose.
  await createUser(FRESH_ID, COMMUNITY_JOIN_MIN_ACCOUNT_AGE_DAYS - 2);

  // Founding is gated on standing (derived from earned ledger income), so the
  // fixture owner needs real non-milestone income before it can create.
  await prisma.orm.public.Users.where((user) =>
    user.id.eq(OWNER_ID)
  ).updateAndCount({
    aura: 100_000,
  });
  await prisma.orm.public.AuraLogs.create({
    _type: "COMMUNITY_JOIN",
    amount: 100_000,
    id: randomUUID(),
    issuerId: OWNER_ID,
    targetUserId: OWNER_ID,
    userId: OWNER_ID,
  });

  await createCommunity({
    description: "Public community for join-bonus tests.",
    name: "JB Public",
    ownerId: OWNER_ID,
    slug: PUBLIC_SLUG,
    topics: ["technology"],
  });
  await createCommunity({
    description: "Restricted community for join-bonus tests.",
    name: "JB Restricted",
    ownerId: OWNER_ID,
    slug: RESTRICTED_SLUG,
    topics: ["technology"],
    type: "RESTRICTED",
  });
});

afterAll(async () => {
  const userIds = [OWNER_ID, MATURE_ID, FRESH_ID];
  await prisma.orm.public.AuraLogs.where((log) =>
    or(log.issuerId.in(userIds), log.userId.in(userIds))
  ).deleteAndCount();
  await prisma.orm.public.Communities.where((community) =>
    community.slug.in([PUBLIC_SLUG, RESTRICTED_SLUG])
  ).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in(userIds)
  ).deleteAndCount();
  await redis.del(`community:stats:${PUBLIC_SLUG}`);
});

describe("community join bonus", () => {
  test("a mature joiner is paid once and the owner is credited", async () => {
    const community = await communityBySlug(PUBLIC_SLUG);

    const before = await auraOf(MATURE_ID);
    const ownerBefore = await auraOf(OWNER_ID);

    await joinCommunity(community.id, MATURE_ID);

    expect(await auraOf(MATURE_ID)).toBe(before + COMMUNITY_JOIN_AURA);
    expect(await auraOf(OWNER_ID)).toBe(
      ownerBefore + COMMUNITY_JOIN_OWNER_AURA
    );

    const marker = await prisma.orm.public.CommunityJoinBonuses.select(
      "joinerAura"
    )
      .where((bonus) =>
        and(bonus.communityId.eq(community.id), bonus.userId.eq(MATURE_ID))
      )
      .first();
    expect(marker?.joinerAura).toBe(COMMUNITY_JOIN_AURA);
  });

  test("leave and rejoin never pays a second time", async () => {
    const community = await communityBySlug(PUBLIC_SLUG);

    const before = await auraOf(MATURE_ID);

    await leaveCommunity(community.id, MATURE_ID);
    expect(await joinedCommunityIds(MATURE_ID)).not.toContain(community.id);

    await joinCommunity(community.id, MATURE_ID);

    // Membership is restored, but the durable marker blocked the payout.
    expect(await joinedCommunityIds(MATURE_ID)).toContain(community.id);
    expect(await auraOf(MATURE_ID)).toBe(before);
  });

  test("a too-young account joins but is not paid", async () => {
    const community = await communityBySlug(PUBLIC_SLUG);

    const before = await auraOf(FRESH_ID);
    await joinCommunity(community.id, FRESH_ID);

    expect(await joinedCommunityIds(FRESH_ID)).toContain(community.id);
    expect(await auraOf(FRESH_ID)).toBe(before);
    const freshMarker = await prisma.orm.public.CommunityJoinBonuses.select(
      "id"
    )
      .where((bonus) =>
        and(bonus.communityId.eq(community.id), bonus.userId.eq(FRESH_ID))
      )
      .first();
    expect(freshMarker).toBeNull();
  });

  test("the owner joining their own community is never paid", async () => {
    const community = await communityBySlug(PUBLIC_SLUG);

    const before = await auraOf(OWNER_ID);
    // The owner is already an ACTIVE member, so this is a no-op join; assert
    // the marker was never written either way.
    await expect(joinCommunity(community.id, OWNER_ID)).rejects.toThrow();
    expect(await auraOf(OWNER_ID)).toBe(before);
  });

  test("restricted communities pay on approval, not on request", async () => {
    const community = await communityBySlug(RESTRICTED_SLUG);

    const before = await auraOf(FRESH_ID);
    const { status } = await joinCommunity(community.id, FRESH_ID);
    expect(status).toBe("PENDING");
    // PENDING pays nothing.
    expect(await auraOf(FRESH_ID)).toBe(before);

    // A fresh account is still age-gated, so approval must not pay it either.
    await approveMember(community.id, community.ownerId, FRESH_ID);
    expect(await auraOf(FRESH_ID)).toBe(before);
  });

  test("the daily ceiling stops paying but never blocks joining", async () => {
    // Build enough communities to exceed the cap. Created directly rather than
    // through the gated service: the service caps an account at
    // COMMUNITY_MAX_OWNED, and this test needs more communities than that from
    // one owner.
    const slugs: string[] = [];
    const joinsAtCap = Math.ceil(
      COMMUNITY_JOIN_DAILY_AURA_CAP / COMMUNITY_JOIN_AURA
    );
    const communityIds = await Promise.all(
      Array.from({ length: joinsAtCap + 1 }, (_, index) => {
        const slug = `jbc${RUN_ID}${index}`;
        slugs.push(slug);
        return prisma.orm.public.Communities.create({
          description: `Cap test community ${index}`,
          id: randomUUID(),
          name: `JBC ${index}`,
          ownerId: OWNER_ID,
          slug,
          topics: ["technology"],
        }).then((created) => created.id);
      })
    );

    // A second mature account, so the earlier tests' income does not interfere.
    const sweepId = `jb-sweep-${RUN_ID}`;
    await createUser(sweepId, 100);

    try {
      // Sequential on purpose: the daily ceiling depends on the running total,
      // so these joins must not race each other.
      // eslint-disable-next-line no-await-in-loop -- order-dependent running total
      for (const communityId of communityIds) {
        // eslint-disable-next-line no-await-in-loop -- see above
        await joinCommunity(communityId, sweepId);
      }

      // Every join is a real membership...
      expect(await joinedCommunityIds(sweepId)).toHaveLength(
        communityIds.length
      );
      // ...but total paid joiner aura cannot exceed the daily ceiling.
      const paid = await prisma.orm.public.CommunityJoinBonuses.where((bonus) =>
        bonus.userId.eq(sweepId)
      ).aggregate((aggregate) => ({ total: aggregate.sum("joinerAura") }));
      expect(paid.total ?? 0).toBeLessThanOrEqual(
        COMMUNITY_JOIN_DAILY_AURA_CAP
      );
      expect(await auraOf(sweepId)).toBeLessThanOrEqual(
        COMMUNITY_JOIN_DAILY_AURA_CAP
      );
    } finally {
      await prisma.orm.public.AuraLogs.where((log) =>
        or(log.issuerId.eq(sweepId), log.userId.eq(sweepId))
      ).deleteAndCount();
      await prisma.orm.public.Communities.where((community) =>
        community.slug.in(slugs)
      ).deleteAndCount();
      await prisma.orm.public.Users.where((user) =>
        user.id.eq(sweepId)
      ).deleteAndCount();
    }
  });

  test("parallel joins cannot overshoot the daily ceiling", async () => {
    // The cap check and the payout race when joins run concurrently: without a
    // per-user lock every join reads the same running total, each concludes the
    // gift fits, and the sum blows past the ceiling. Fire more joins than the
    // cap can fund at once and assert the total still holds.
    const joinsAtCap = Math.ceil(
      COMMUNITY_JOIN_DAILY_AURA_CAP / COMMUNITY_JOIN_AURA
    );
    const concurrency = joinsAtCap + 2;
    const slugs: string[] = [];
    const communityIds = await Promise.all(
      Array.from({ length: concurrency }, (_, index) => {
        const slug = `jbx${RUN_ID}${index}`;
        slugs.push(slug);
        return prisma.orm.public.Communities.create({
          description: `Parallel cap community ${index}`,
          id: randomUUID(),
          name: `JBX ${index}`,
          ownerId: OWNER_ID,
          slug,
          topics: ["technology"],
        }).then((created) => created.id);
      })
    );

    const racerId = `jb-race-${RUN_ID}`;
    await createUser(racerId, 100);

    try {
      await Promise.all(
        communityIds.map((communityId) => joinCommunity(communityId, racerId))
      );

      // Every join is a real membership...
      expect(await joinedCommunityIds(racerId)).toHaveLength(concurrency);

      // ...but the paid total never exceeds the ceiling, and every pair was
      // marked (capped ones with a zero payout) so a rejoin cannot revisit it.
      const paid = await prisma.orm.public.CommunityJoinBonuses.where((bonus) =>
        bonus.userId.eq(racerId)
      ).aggregate((aggregate) => ({ total: aggregate.sum("joinerAura") }));
      expect(paid.total ?? 0).toBeLessThanOrEqual(
        COMMUNITY_JOIN_DAILY_AURA_CAP
      );
      const marked = await prisma.orm.public.CommunityJoinBonuses.where(
        (bonus) => bonus.userId.eq(racerId)
      ).aggregate((aggregate) => ({ count: aggregate.count() }));
      expect(marked.count).toBe(concurrency);
    } finally {
      await prisma.orm.public.AuraLogs.where((log) =>
        or(log.issuerId.eq(racerId), log.userId.eq(racerId))
      ).deleteAndCount();
      await prisma.orm.public.Communities.where((community) =>
        community.slug.in(slugs)
      ).deleteAndCount();
      await prisma.orm.public.Users.where((user) =>
        user.id.eq(racerId)
      ).deleteAndCount();
    }
  });
});
