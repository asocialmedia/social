import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  approveMember,
  canViewCommunity,
  canViewCommunityById,
  communityVisibilityWhere,
  createCommunity,
  getCommunityBySlug,
  joinCommunity,
  leaveCommunity,
  prisma,
  redis,
} from "@asm/db";

// View access for PRIVATE communities. PUBLIC/RESTRICTED stay world-readable;
// PRIVATE is readable only by an ACTIVE (approved) member, so a guest who
// guesses the slug and a PENDING applicant are both denied.

const RUN_ID =
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    .replaceAll("-", "_")
    .slice(0, 18);

const OWNER_ID = `vis-owner-${RUN_ID}`;
const MEMBER_ID = `vis-member-${RUN_ID}`;
const STRANGER_ID = `vis-stranger-${RUN_ID}`;
const PRIVATE_SLUG = `visp${RUN_ID}`;
const PUBLIC_SLUG = `visu${RUN_ID}`;

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
  await createUser(MEMBER_ID);
  await createUser(STRANGER_ID);
  // Founding is gated on standing derived from earned ledger income, so the
  // owner needs a real non-milestone row before createCommunity will pass.
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
    description: "Private visibility fixture.",
    name: "Vis Private",
    ownerId: OWNER_ID,
    slug: PRIVATE_SLUG,
    topics: ["technology"],
    type: "PRIVATE",
  });
  await createCommunity({
    description: "Public visibility fixture.",
    name: "Vis Public",
    ownerId: OWNER_ID,
    slug: PUBLIC_SLUG,
    topics: ["technology"],
  });
});

afterAll(async () => {
  const userIds = [OWNER_ID, MEMBER_ID, STRANGER_ID];
  await prisma.auraLog.deleteMany({
    where: { OR: [{ issuerId: { in: userIds } }, { userId: { in: userIds } }] },
  });
  await prisma.community.deleteMany({
    where: { slug: { in: [PRIVATE_SLUG, PUBLIC_SLUG] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await redis.del(`community:stats:${PRIVATE_SLUG}`);
  await redis.del(`community:stats:${PUBLIC_SLUG}`);
});

describe("community view access", () => {
  test("a PRIVATE community denies guests and non-members", async () => {
    const community = await getCommunityBySlug(PRIVATE_SLUG);
    if (!community) {
      throw new Error("private community missing");
    }

    expect(await canViewCommunity(community, "")).toBe(false);
    expect(await canViewCommunity(community, STRANGER_ID)).toBe(false);
    expect(await canViewCommunityById(community.id, STRANGER_ID)).toBe(false);

    // The owner is the founding ACTIVE member, so they can always view.
    expect(await canViewCommunity(community, OWNER_ID)).toBe(true);
  });

  test("a PENDING applicant is not yet approved to view", async () => {
    const community = await getCommunityBySlug(PRIVATE_SLUG);
    if (!community) {
      throw new Error("private community missing");
    }

    const { status } = await joinCommunity(community.id, MEMBER_ID);
    expect(status).toBe("PENDING");
    expect(await canViewCommunity(community, MEMBER_ID)).toBe(false);

    // Approval flips the membership ACTIVE and the gate opens.
    await approveMember(community.id, OWNER_ID, MEMBER_ID);
    expect(await canViewCommunity(community, MEMBER_ID)).toBe(true);

    // Losing the membership closes it again.
    await leaveCommunity(community.id, MEMBER_ID);
    expect(await canViewCommunity(community, MEMBER_ID)).toBe(false);
  });

  test("PUBLIC communities are world-readable", async () => {
    const community = await getCommunityBySlug(PUBLIC_SLUG);
    if (!community) {
      throw new Error("public community missing");
    }

    expect(await canViewCommunity(community, "")).toBe(true);
    expect(await canViewCommunity(community, STRANGER_ID)).toBe(true);
    expect(await canViewCommunityById(community.id, "")).toBe(true);
  });

  test("canViewCommunityById returns false for a missing community", async () => {
    expect(await canViewCommunityById("no-such-community", "")).toBe(false);
  });

  test("communityVisibilityWhere hides private posts from global reads", async () => {
    const privateCommunity = await getCommunityBySlug(PRIVATE_SLUG);
    const publicCommunity = await getCommunityBySlug(PUBLIC_SLUG);
    if (!(privateCommunity && publicCommunity)) {
      throw new Error("communities missing");
    }

    const [privatePost, publicPost, globalPost] = await Promise.all([
      prisma.post.create({
        data: {
          communityId: privateCommunity.id,
          content: "private community post",
          userId: OWNER_ID,
        },
      }),
      prisma.post.create({
        data: {
          communityId: publicCommunity.id,
          content: "public community post",
          userId: OWNER_ID,
        },
      }),
      prisma.post.create({
        data: { content: "global post", userId: OWNER_ID },
      }),
    ]);

    try {
      // A guest sees the public and global posts, never the private one.
      const guestPosts = await prisma.post.findMany({
        select: { id: true },
        where: {
          AND: [communityVisibilityWhere("")],
          id: { in: [privatePost.id, publicPost.id, globalPost.id] },
        },
      });
      const guestIds = guestPosts.map((post) => post.id);
      expect(guestIds).toContain(publicPost.id);
      expect(guestIds).toContain(globalPost.id);
      expect(guestIds).not.toContain(privatePost.id);

      // A non-member stranger is treated like a guest.
      const strangerPosts = await prisma.post.findMany({
        select: { id: true },
        where: {
          AND: [communityVisibilityWhere(STRANGER_ID)],
          id: { in: [privatePost.id] },
        },
      });
      expect(strangerPosts).toHaveLength(0);

      // An approved member (the founding owner) sees it.
      const memberPosts = await prisma.post.findMany({
        select: { id: true },
        where: {
          AND: [communityVisibilityWhere(OWNER_ID)],
          id: { in: [privatePost.id] },
        },
      });
      expect(memberPosts.map((post) => post.id)).toEqual([privatePost.id]);
    } finally {
      await prisma.post.deleteMany({
        where: { id: { in: [privatePost.id, publicPost.id, globalPost.id] } },
      });
    }
  });
});
