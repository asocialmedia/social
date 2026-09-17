import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  COMMUNITY_MAX_MODERATORS,
  CommunityError,
  createCommunity,
  getMembership,
  getUserCommunityRoles,
  joinCommunity,
  leaveCommunity,
  prisma,
  setMemberRole,
} from "@asm/db";

// Coverage for the community role model: joining grants PARTICIPANT, the owner
// promotes participants to member and members to moderator, moderators may only
// toggle participant/member, and moderators are capped.

const RUN_ID =
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    .replaceAll("-", "_")
    .slice(0, 18);

const OWNER_ID = `role-owner-${RUN_ID}`;
const MOD_ID = `role-mod-${RUN_ID}`;
const PLAIN_ID = `role-plain-${RUN_ID}`;
const SLUG = `role${RUN_ID}`;

async function createUser(id: string): Promise<void> {
  await prisma.user.create({
    data: {
      displayName: id,
      email: `${id}@example.test`,
      id,
      username: id,
    },
  });
}

beforeAll(async () => {
  await createUser(OWNER_ID);
  await createUser(MOD_ID);
  await createUser(PLAIN_ID);
  await prisma.user.update({
    data: { aura: 100_000 },
    where: { id: OWNER_ID },
  });
  await prisma.auraLog.create({
    data: {
      amount: 100_000,
      issuerId: OWNER_ID,
      targetUserId: OWNER_ID,
      type: "POST_CREATION",
      userId: OWNER_ID,
    },
  });
  await createCommunity({
    description: "Role model integration test community.",
    name: "Role IT",
    ownerId: OWNER_ID,
    slug: SLUG,
    topics: ["technology"],
  });
});

afterAll(async () => {
  const userIds = [OWNER_ID, MOD_ID, PLAIN_ID];
  await prisma.auraLog.deleteMany({
    where: { OR: [{ issuerId: { in: userIds } }, { userId: { in: userIds } }] },
  });
  await prisma.community.deleteMany({ where: { slug: SLUG } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

async function communityId(): Promise<string> {
  const community = await prisma.community.findUniqueOrThrow({
    select: { id: true },
    where: { slug: SLUG },
  });
  return community.id;
}

describe("community role model", () => {
  test("joining grants PARTICIPANT, not MEMBER", async () => {
    const id = await communityId();
    await joinCommunity(id, PLAIN_ID);
    expect(await getMembership(id, PLAIN_ID)).toEqual({
      role: "PARTICIPANT",
      status: "ACTIVE",
    });
  });

  test("a participant carries no badged community role", async () => {
    expect(await getUserCommunityRoles(PLAIN_ID)).toHaveLength(0);
  });

  test("the owner promotes a participant to member", async () => {
    const id = await communityId();
    await setMemberRole(id, OWNER_ID, PLAIN_ID, "MEMBER");
    expect(await getMembership(id, PLAIN_ID)).toEqual({
      role: "MEMBER",
      status: "ACTIVE",
    });
    const roles = await getUserCommunityRoles(PLAIN_ID);
    expect(roles.some((entry) => entry.role === "MEMBER")).toBe(true);
  });

  test("the owner appoints a moderator, and the cap is enforced", async () => {
    const id = await communityId();
    // A moderator must be a member first: roles are assigned to members, not
    // conjured for strangers.
    await joinCommunity(id, MOD_ID);
    await setMemberRole(id, OWNER_ID, MOD_ID, "MODERATOR");
    expect(await getMembership(id, MOD_ID)).toEqual({
      role: "MODERATOR",
      status: "ACTIVE",
    });

    // Fill the remaining moderator slots, then assert the next one is refused.
    // Sequential on purpose: each promotion consumes the next moderator slot,
    // so the cap must be observed against a deterministic running count.
    const extraIds: string[] = [];
    // eslint-disable-next-line no-await-in-loop -- order-dependent moderator count
    for (let index = 1; index < COMMUNITY_MAX_MODERATORS; index += 1) {
      const extraId = `role-extra-${RUN_ID}-${index}`;
      extraIds.push(extraId);
      // eslint-disable-next-line no-await-in-loop -- see above
      await createUser(extraId);
      // eslint-disable-next-line no-await-in-loop -- see above
      await joinCommunity(id, extraId);
      // eslint-disable-next-line no-await-in-loop -- see above
      await setMemberRole(id, OWNER_ID, extraId, "MODERATOR");
    }

    const overflowId = `role-overflow-${RUN_ID}`;
    await createUser(overflowId);
    await joinCommunity(id, overflowId);

    await expect(
      setMemberRole(id, OWNER_ID, overflowId, "MODERATOR")
    ).rejects.toThrow(CommunityError);

    // Cleanup the extras so afterAll's scoped delete stays simple.
    await prisma.auraLog.deleteMany({
      where: {
        OR: [
          { issuerId: { in: [...extraIds, overflowId] } },
          { userId: { in: [...extraIds, overflowId] } },
        ],
      },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [...extraIds, overflowId] } },
    });
  });

  test("a moderator cannot appoint another moderator", async () => {
    const id = await communityId();
    await expect(
      setMemberRole(id, MOD_ID, PLAIN_ID, "MODERATOR")
    ).rejects.toThrow(CommunityError);
  });

  test("a moderator may toggle participant and member", async () => {
    const id = await communityId();
    await setMemberRole(id, MOD_ID, PLAIN_ID, "PARTICIPANT");
    const asParticipant = await getMembership(id, PLAIN_ID);
    expect(asParticipant?.role).toBe("PARTICIPANT");
    await setMemberRole(id, MOD_ID, PLAIN_ID, "MEMBER");
    const asMember = await getMembership(id, PLAIN_ID);
    expect(asMember?.role).toBe("MEMBER");
  });

  test("the owner's role cannot be changed", async () => {
    const id = await communityId();
    await expect(
      setMemberRole(id, OWNER_ID, OWNER_ID, "MEMBER")
    ).rejects.toThrow(CommunityError);
  });

  test("leaving drops a promoted role, so a rejoin is a plain participant", async () => {
    const id = await communityId();
    await leaveCommunity(id, PLAIN_ID);
    await joinCommunity(id, PLAIN_ID);
    // leaveCommunity deletes the membership row, so the promotion does not
    // survive; a returning member must be re-promoted.
    const rejoined = await getMembership(id, PLAIN_ID);
    expect(rejoined?.role).toBe("PARTICIPANT");
  });
});
