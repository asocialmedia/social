import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import {
  and,
  approveMember,
  canViewCommunity,
  communityNotificationVisibilityWhere,
  cancelCommunityMembershipRequest,
  createCommunity,
  decideCommunityMembershipRequest,
  getCommunityBySlug,
  getCommunityCategoryCounts,
  getCommunityChatMessages,
  getCommunityPreview,
  getUserDataQuery,
  getMembership,
  getNotificationDataQuery,
  mapNotificationData,
  joinCommunity,
  leaveCommunity,
  listCommunities,
  listCommunityMembershipRequests,
  prisma,
  redis,
  searchCommunities,
} from "@asm/db";

import { assertCommunityRequestRate } from "./membership-policy";

const run = randomUUID().slice(0, 8);
const owner = `pr-owner-${run}`;
const applicant = `pr-user-${run}`;
const outsider = `pr-other-${run}`;
const slug = `private${run}`;
const users = [owner, applicant, outsider];
let communityId = "";

beforeAll(async () => {
  await Promise.all(
    users.map((id) =>
      prisma.orm.public.Users.create({
        displayName: id,
        email: `${id}@example.test`,
        id,
        username: id,
      })
    )
  );
  await prisma.orm.public.AuraLogs.create({
    _type: "COMMUNITY_JOIN",
    amount: 100_000,
    issuerId: owner,
    targetUserId: owner,
    userId: owner,
  });
  const community = await createCommunity({
    description: "Public identity, protected contents",
    name: `Private ${run}`,
    ownerId: owner,
    slug,
    topics: ["technology"],
    type: "PRIVATE",
  });
  communityId = community.id;
}, 30_000);

afterAll(async () => {
  await prisma.orm.public.Communities.where({
    id: communityId,
  }).deleteAndCount();
  await prisma.orm.public.AuraLogs.where((row) =>
    row.userId.in(users)
  ).deleteAndCount();
  await prisma.orm.public.Users.where((row) =>
    row.id.in(users)
  ).deleteAndCount();
  await redis.del(...users.flatMap((id) => [`unread:notif:${id}`]));
});

async function pendingId(userId = applicant) {
  const membership = await prisma.orm.public.CommunityMembers.select("id")
    .where((row) =>
      and(
        row.communityId.eq(communityId),
        row.userId.eq(userId),
        row.status.eq("PENDING")
      )
    )
    .first();
  if (!membership) {
    throw new Error("Pending request missing");
  }
  return membership.id;
}

describe("private community requests", () => {
  test("public preview excludes internal fields and private content", async () => {
    const preview = await getCommunityPreview(slug, "");
    expect(preview?.community.name).toBe(`Private ${run}`);
    expect(preview?.community.memberCount).toBe(1);
    expect(preview?.permissions.canReadContent).toBe(false);
    expect(preview?.permissions.canReadChat).toBe(false);
    expect(preview?.permissions.canRequest).toBe(false);
    for (const key of [
      "ownerId",
      "_count",
      "posts",
      "weeklyVisitors",
      "communityAura",
    ]) {
      expect(preview?.community).not.toHaveProperty(key);
    }
  });

  test("public profiles do not reveal private-community affiliations to outsiders", async () => {
    const outsiderView = await getUserDataQuery(prisma.orm, outsider)
      .where({ id: owner })
      .first();
    expect(
      outsiderView?.communityMembers.some(
        (member) => member.community?.slug === slug
      )
    ).toBe(false);
    const ownerView = await getUserDataQuery(prisma.orm, owner)
      .where({ id: owner })
      .first();
    expect(
      ownerView?.communityMembers.some(
        (member) => member.community?.slug === slug
      )
    ).toBe(true);
  });

  test("website discovery includes private communities without changing legacy discovery", async () => {
    const legacySearch = await searchCommunities(slug, 10);
    expect(legacySearch.communities).toHaveLength(0);
    const websiteSearch = await searchCommunities(slug, 10, true);
    expect(websiteSearch.communities.map((row) => row.id)).toContain(
      communityId
    );
    const directoryPage = await listCommunities({
      includePrivate: true,
      limit: 48,
    });
    expect(directoryPage.total).toBeGreaterThan(0);
    const categoryCounts = await getCommunityCategoryCounts(true);
    expect(categoryCounts.all).toBeGreaterThan(0);
  });

  test("concurrent request retries create one pending request and one staff notification", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => joinCommunity(communityId, applicant))
    );
    expect(results.every((result) => result.status === "PENDING")).toBe(true);
    const id = await pendingId();
    const notifications = await prisma.orm.public.Notifications.where((row) =>
      and(
        row.membershipRequestId.eq(id),
        row._type.eq("COMMUNITY_JOIN_REQUEST")
      )
    ).all();
    expect(notifications).toHaveLength(1);
    const allowed = await prisma.orm.public.Notifications.where({
      membershipRequestId: id,
    })
      .where(communityNotificationVisibilityWhere(owner))
      .all();
    const denied = await prisma.orm.public.Notifications.where({
      membershipRequestId: id,
    })
      .where(communityNotificationVisibilityWhere(outsider))
      .all();
    expect(allowed).toHaveLength(1);
    expect(denied).toHaveLength(0);

    const preview = await getCommunityPreview(slug, applicant);
    expect(preview?.permissions.canReadContent).toBe(false);
    expect(preview?.community.memberCount).toBe(1);
    expect(
      await canViewCommunity({ id: communityId, type: "PRIVATE" }, applicant)
    ).toBe(false);
    const room = await prisma.orm.public.CommunityChatRooms.select("id")
      .where({ communityId })
      .first();
    if (!room) {
      throw new Error("General channel missing");
    }
    await expect(
      getCommunityChatMessages({ roomId: room.id, userId: applicant })
    ).rejects.toThrow();
  });

  test("request list requires staff and supports cursor pagination", async () => {
    await joinCommunity(communityId, outsider);
    await expect(
      listCommunityMembershipRequests(communityId, applicant)
    ).rejects.toThrow();
    const first = await listCommunityMembershipRequests(
      communityId,
      owner,
      undefined,
      1
    );
    expect(first.total).toBe(2);
    expect(first.requests).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const next = await listCommunityMembershipRequests(
      communityId,
      owner,
      first.nextCursor ?? undefined,
      1
    );
    expect(next.requests).toHaveLength(1);
    expect(next.requests[0]?.id).not.toBe(first.requests[0]?.id);
    expect(next.nextCursor).toBeNull();
    await leaveCommunity(communityId, outsider);
  });

  test("decline permits immediate re-request and stale decisions cannot affect it", async () => {
    const oldId = await pendingId();
    const declined = await decideCommunityMembershipRequest(
      communityId,
      owner,
      oldId,
      "decline"
    );
    expect(declined.applied).toBe(true);
    const declinedMembership = await getMembership(communityId, applicant);
    expect(declinedMembership).toBeNull();
    const decisionRow = await getNotificationDataQuery(prisma.orm)
      .where((row) =>
        and(
          row.membershipRequestId.eq(oldId),
          row._type.eq("COMMUNITY_JOIN_DECLINED")
        )
      )
      .first();
    if (!decisionRow) {
      throw new Error("Decision notification missing");
    }
    const visibleDecision = mapNotificationData(decisionRow);
    expect(visibleDecision.issuerId).toBe(communityId);
    expect(visibleDecision.issuer.displayName).toBe(`Private ${run}`);

    await joinCommunity(communityId, applicant);
    const newId = await pendingId();
    expect(newId).not.toBe(oldId);
    const staleApproval = await decideCommunityMembershipRequest(
      communityId,
      owner,
      oldId,
      "approve"
    );
    const staleDecline = await decideCommunityMembershipRequest(
      communityId,
      owner,
      oldId,
      "decline"
    );
    expect(staleApproval.applied).toBe(false);
    expect(staleDecline.applied).toBe(false);
    const pending = await getMembership(communityId, applicant);
    expect(pending?.status).toBe("PENDING");
  });

  test("racing approval and decline resolves exactly once", async () => {
    const id = await pendingId();
    const decisions = await Promise.all([
      decideCommunityMembershipRequest(communityId, owner, id, "approve"),
      decideCommunityMembershipRequest(communityId, owner, id, "decline"),
    ]);
    expect(decisions.filter((result) => result.applied)).toHaveLength(1);
    const notifications = await prisma.orm.public.Notifications.where((row) =>
      and(
        row.membershipRequestId.eq(id),
        row._type.in(["COMMUNITY_JOIN_APPROVED", "COMMUNITY_JOIN_DECLINED"])
      )
    ).all();
    expect(notifications).toHaveLength(1);
    const settledMembership = await getMembership(communityId, applicant);
    if (settledMembership?.status === "ACTIVE") {
      await leaveCommunity(communityId, applicant);
    }
  });

  test("approval unlocks history and leaving removes access", async () => {
    await joinCommunity(communityId, outsider);
    const id = await pendingId(outsider);
    const approved = await decideCommunityMembershipRequest(
      communityId,
      owner,
      id,
      "approve"
    );
    expect(approved.applied).toBe(true);
    const approvedPreview = await getCommunityPreview(slug, outsider);
    expect(approvedPreview?.permissions.canReadContent).toBe(true);
    const approvedCommunity = await getCommunityBySlug(slug);
    expect(approvedCommunity?._count.members).toBe(2);
    await leaveCommunity(communityId, outsider);
    const departedPreview = await getCommunityPreview(slug, outsider);
    expect(departedPreview?.permissions.canReadChat).toBe(false);
    const departedCommunity = await getCommunityBySlug(slug);
    expect(departedCommunity?._count.members).toBe(1);
  });

  test("pending cancellation cannot remove an already approved membership", async () => {
    await joinCommunity(communityId, outsider);
    const id = await pendingId(outsider);
    await decideCommunityMembershipRequest(communityId, owner, id, "approve");
    await cancelCommunityMembershipRequest(communityId, outsider);
    const membership = await getMembership(communityId, outsider);
    expect(membership?.status).toBe("ACTIVE");
    await leaveCommunity(communityId, outsider);
  });

  test("approval races respect the last available member slot", async () => {
    await Promise.all([
      joinCommunity(communityId, applicant),
      joinCommunity(communityId, outsider),
    ]);
    const ids = await Promise.all([pendingId(applicant), pendingId(outsider)]);
    await prisma.orm.public.Communities.where({ id: communityId }).update({
      activeMemberCount: 99_999,
    });
    const approvals = await Promise.allSettled(
      ids.map((id) =>
        decideCommunityMembershipRequest(communityId, owner, id, "approve")
      )
    );
    expect(
      approvals.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    const community = await getCommunityBySlug(slug);
    expect(community?._count.members).toBe(100_000);
    await Promise.all([
      leaveCommunity(communityId, applicant),
      leaveCommunity(communityId, outsider),
    ]);
    await prisma.orm.public.Communities.where({ id: communityId }).update({
      activeMemberCount: 1,
    });
  });

  test("shared request policy enforces community and account-wide rate limits", async () => {
    const pairUser = `rate-pair-${run}`;
    const accountUser = `rate-account-${run}`;
    const pair = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        assertCommunityRequestRate(communityId, pairUser)
      )
    );
    expect(pair.filter((result) => result.status === "fulfilled")).toHaveLength(
      5
    );
    const account = await Promise.allSettled(
      Array.from({ length: 21 }, (_, index) =>
        assertCommunityRequestRate(`${communityId}-${index}`, accountUser)
      )
    );
    expect(
      account.filter((result) => result.status === "fulfilled")
    ).toHaveLength(20);
  });

  test("ban blocks requesting and approval without exposing content", async () => {
    await joinCommunity(communityId, outsider);
    const id = await pendingId(outsider);
    await prisma.orm.public.CommunityChatSanctions.create({
      actorId: owner,
      communityId,
      kind: "BAN",
      userId: outsider,
    });
    await expect(
      approveMember(communityId, owner, outsider, id)
    ).rejects.toThrow();
    await expect(joinCommunity(communityId, outsider)).rejects.toThrow();
    const bannedPreview = await getCommunityPreview(slug, outsider);
    expect(bannedPreview?.permissions.canRequest).toBe(false);
  });
});
