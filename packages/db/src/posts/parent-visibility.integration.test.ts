import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { createCommunity, getPostDataQuery, prisma } from "@asm/db";
import { or } from "@prisma/orm-postgres/orm-client";

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
  await prisma.orm.public.Users.create({
    displayName: id,
    email: `${id}@example.test`,
    id,
    username: id,
  });
}

beforeAll(async () => {
  await createUser(OWNER_ID);
  await createUser(STRANGER_ID);
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

  const community = await createCommunity({
    description: "Parent visibility fixture.",
    name: "Parent Vis Private",
    ownerId: OWNER_ID,
    slug: PRIVATE_SLUG,
    topics: ["technology"],
    type: "PRIVATE",
  });

  // The parent lives in the private community.
  const parent = await prisma.orm.public.Posts.create({
    communityId: community.id,
    content: SECRET_CONTENT,
    id: randomUUID(),
    userId: OWNER_ID,
  });
  _privateParentId = parent.id;

  // The reply carries NO community, so it is a global (world-readable) post
  // that nevertheless points at the private parent.
  const reply = await prisma.orm.public.Posts.create({
    content: REPLY_CONTENT,
    id: randomUUID(),
    parentPostId: parent.id,
    rootPostId: parent.id,
    userId: OWNER_ID,
  });
  globalReplyId = reply.id;
});

afterAll(async () => {
  const userIds = [OWNER_ID, STRANGER_ID];
  await prisma.orm.public.Posts.where((post) =>
    post.userId.in(userIds)
  ).deleteAndCount();
  await prisma.orm.public.AuraLogs.where((log) =>
    or(log.issuerId.in(userIds), log.userId.in(userIds))
  ).deleteAndCount();
  await prisma.orm.public.Communities.where((community) =>
    community.slug.eq(PRIVATE_SLUG)
  ).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in(userIds)
  ).deleteAndCount();
});

describe("embedded parent visibility", () => {
  test("a global reply never embeds a parent the viewer cannot read", async () => {
    const reply = await getPostDataQuery(prisma.orm, "")
      .where((post) => post.id.eq(globalReplyId))
      .first();
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
    const reply = await getPostDataQuery(prisma.orm, OWNER_ID)
      .where((post) => post.id.eq(globalReplyId))
      .first();
    expect(reply?.parentPost?.content).toBe(SECRET_CONTENT);
  });

  test("a stranger logged in is denied the parent too", async () => {
    const reply = await getPostDataQuery(prisma.orm, STRANGER_ID)
      .where((post) => post.id.eq(globalReplyId))
      .first();
    expect(JSON.stringify(reply)).not.toContain(SECRET_CONTENT);
  });
});
