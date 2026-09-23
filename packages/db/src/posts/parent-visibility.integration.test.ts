import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createCommunity, getPostDataInclude, prisma } from "@asm/db";

// A reply is a normal post with `parentPostId` set; its `communityId` is the
// REPLIER's choice, not inherited from the parent. So a member can reply to a
// post inside a PRIVATE community and publish that reply globally. The parent
// is embedded on the reply via getPostDataInclude's `parentPost` projection, so
// without a visibility check the reply becomes a backdoor that ships the
// private post's content to every reader - including guests.
//
// Same class of hole as the ancestor chain, but more direct: the leaked content
// rides on the reply itself rather than a separate lookup.

const RUN_ID =
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    .replaceAll("-", "_")
    .slice(0, 18);

const OWNER_ID = `pv-owner-${RUN_ID}`;
const STRANGER_ID = `pv-stranger-${RUN_ID}`;
const PRIVATE_SLUG = `pvp${RUN_ID}`;
const SECRET_CONTENT = `private-community-secret-${RUN_ID}`;
const REPLY_CONTENT = `public-reply-${RUN_ID}`;

let _privateParentId = "";
let globalReplyId = "";

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
  await createUser(STRANGER_ID);
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

  const community = await createCommunity({
    description: "Parent visibility fixture.",
    name: "Parent Vis Private",
    ownerId: OWNER_ID,
    slug: PRIVATE_SLUG,
    topics: ["technology"],
    type: "PRIVATE",
  });

  // The parent lives in the private community.
  const parent = await prisma.post.create({
    data: {
      communityId: community.id,
      content: SECRET_CONTENT,
      userId: OWNER_ID,
    },
  });
  _privateParentId = parent.id;

  // The reply carries NO community, so it is a global (world-readable) post
  // that nevertheless points at the private parent.
  const reply = await prisma.post.create({
    data: {
      content: REPLY_CONTENT,
      parentPostId: parent.id,
      rootPostId: parent.id,
      userId: OWNER_ID,
    },
  });
  globalReplyId = reply.id;
});

afterAll(async () => {
  const userIds = [OWNER_ID, STRANGER_ID];
  await prisma.post.deleteMany({
    where: { userId: { in: userIds } },
  });
  await prisma.auraLog.deleteMany({
    where: { OR: [{ issuerId: { in: userIds } }, { userId: { in: userIds } }] },
  });
  await prisma.community.deleteMany({ where: { slug: PRIVATE_SLUG } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("embedded parent visibility", () => {
  test("a global reply never embeds a parent the viewer cannot read", async () => {
    const reply = await prisma.post.findUnique({
      include: getPostDataInclude(""),
      where: { id: globalReplyId },
    });
    if (!reply) {
      throw new Error("reply missing");
    }

    // The reply itself is global and readable...
    expect(reply.content).toBe(REPLY_CONTENT);
    // ...but it must not carry the private parent's content to a guest.
    expect(reply.parentPost?.content ?? null).not.toBe(SECRET_CONTENT);
    expect(JSON.stringify(reply)).not.toContain(SECRET_CONTENT);
  });

  test("the owner (a member) still sees the parent, so threads render", async () => {
    const reply = await prisma.post.findUnique({
      include: getPostDataInclude(OWNER_ID),
      where: { id: globalReplyId },
    });
    expect(reply?.parentPost?.content).toBe(SECRET_CONTENT);
  });

  test("a stranger logged in is denied the parent too", async () => {
    const reply = await prisma.post.findUnique({
      include: getPostDataInclude(STRANGER_ID),
      where: { id: globalReplyId },
    });
    expect(JSON.stringify(reply)).not.toContain(SECRET_CONTENT);
  });
});
