import { afterAll, beforeAll, expect, test } from "bun:test";

import type { ExternalAuthor } from "@asm/protocols/contracts";

import prisma from "../prisma";
import {
  externalFollowAuthors,
  externalFollowRegistry,
  externalFollowState,
  reconcileExternalAuthor,
  setExternalFollow,
  MAX_EXTERNAL_FOLLOWS,
} from "./external-follows";

const run = crypto.randomUUID();
const userId = `external-follow-${run}`;
const otherId = `external-follow-other-${run}`;
const deletedId = `external-follow-deleted-${run}`;
const dids: string[] = [];
function author(suffix: string): ExternalAuthor {
  const did = `did:web:${suffix}-${run}.test`;
  dids.push(did);
  return {
    displayName: suffix,
    handle: `${suffix}.test`,
    id: did,
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: `https://bsky.app/profile/${did}`,
  };
}
beforeAll(async () => {
  await Promise.all(
    [userId, otherId, deletedId].map((id) =>
      prisma.orm.public.Users.create({ displayName: id, id, username: id })
    )
  );
});
afterAll(async () => {
  await prisma.orm.public.Users.where((row) =>
    row.id.in([userId, otherId, deletedId])
  ).deleteAndCount();
  await prisma.orm.public.ExternalAuthors.where((row) =>
    row.did.in(dids)
  ).deleteAndCount();
  await prisma.orm.public.ExternalPosts.where({
    id: `follow-post-${run}`,
  }).deleteAndCount();
});

test("concurrent retries create one ASM-only follow and unfollow preserves another user's reference", async () => {
  const target = author("shared");
  await Promise.all(
    Array.from({ length: 20 }, () =>
      setExternalFollow(userId, target.id, true, target)
    )
  );
  expect(await externalFollowAuthors(userId)).toHaveLength(1);
  await setExternalFollow(otherId, target.id, true, target);
  await setExternalFollow(userId, target.id, false);
  expect(await externalFollowState(userId, target.id)).toBe(false);
  expect(await externalFollowState(otherId, target.id)).toBe(true);
  expect(await prisma.orm.public.Accounts.where({ userId }).all()).toEqual([]);
  await setExternalFollow(otherId, target.id, false);
  expect(
    await prisma.orm.public.ExternalAuthors.where({ did: target.id }).first()
  ).toBeNull();
  await setExternalFollow(userId, target.id, false);
});

test("deactivation preserves follows, unknown errors preserve state, reactivation and handle changes preserve DID identity", async () => {
  const target = author("lifecycle");
  await setExternalFollow(userId, target.id, true, target);
  await reconcileExternalAuthor({ did: target.id, status: "deactivated" });
  await reconcileExternalAuthor({ did: target.id, status: "unknown" });
  expect(await externalFollowState(userId, target.id)).toBe(true);
  const [paused] = await externalFollowAuthors(userId);
  expect(paused?.status).toBe("deactivated");
  await reconcileExternalAuthor({
    did: target.id,
    displayName: "New name",
    handle: "changed.test",
    status: "active",
  });
  const [renamed] = await externalFollowAuthors(userId);
  expect(renamed).toMatchObject({
    did: target.id,
    handle: "changed.test",
    status: "active",
  });
  await setExternalFollow(userId, target.id, false);
});

test("confirmed deletion removes every follow and source snapshot while preserving local discussion", async () => {
  const target = author("deleted");
  await setExternalFollow(userId, target.id, true, target);
  await setExternalFollow(otherId, target.id, true, target);
  const postId = `follow-post-${run}`;
  await prisma.orm.public.ExternalPosts.create({
    authorId: target.id,
    id: postId,
    snapshot: { text: "source data" },
    source: "bluesky",
    uri: `at://${target.id}/app.bsky.feed.post/example`,
  });
  await prisma.orm.public.ExternalComments.create({
    content: "ASM discussion",
    externalPostId: postId,
    id: `follow-comment-${run}`,
    requestId: run,
    userId,
  });
  await reconcileExternalAuthor({ did: target.id, status: "deleted" });
  await reconcileExternalAuthor({ did: target.id, status: "deleted" });
  expect(await externalFollowState(userId, target.id)).toBe(false);
  expect(await externalFollowState(otherId, target.id)).toBe(false);
  expect(
    await prisma.orm.public.ExternalAuthors.where({ did: target.id }).first()
  ).toBeNull();
  expect(
    await prisma.orm.public.ExternalPosts.where({ id: postId }).first()
  ).toMatchObject({ available: false, snapshot: null });
  expect(
    await prisma.orm.public.ExternalComments.where({
      externalPostId: postId,
    }).all()
  ).toHaveLength(1);
});

test("deleting an ASM account cascades its follow edges and registry reconciliation prunes the orphan", async () => {
  const target = author("asm-deleted");
  await setExternalFollow(deletedId, target.id, true, target);
  await prisma.orm.public.Users.where({ id: deletedId }).delete();
  expect(
    await prisma.orm.public.ExternalFollows.where({ userId: deletedId }).all()
  ).toEqual([]);
  await externalFollowRegistry();
  expect(
    await prisma.orm.public.ExternalAuthors.where({ did: target.id }).first()
  ).toBeNull();
});

test("concurrent requests cannot exceed the per-user limit and removing follows still works at capacity", async () => {
  const targets = Array.from({ length: MAX_EXTERNAL_FOLLOWS + 2 }, (_, index) =>
    author(`quota-${index}`)
  );
  const results = await Promise.allSettled(
    targets.map((target) => setExternalFollow(userId, target.id, true, target))
  );
  expect(
    results.filter((result) => result.status === "fulfilled")
  ).toHaveLength(MAX_EXTERNAL_FOLLOWS);
  expect(await externalFollowAuthors(userId)).toHaveLength(
    MAX_EXTERNAL_FOLLOWS
  );
  const [first] = await externalFollowAuthors(userId);
  if (!first) {
    throw new Error("Missing followed author");
  }
  await setExternalFollow(userId, first.did, false);
  expect(await externalFollowAuthors(userId)).toHaveLength(
    MAX_EXTERNAL_FOLLOWS - 1
  );
}, 20_000);

test("disconnecting a linked Bluesky account preserves independent ASM follows", async () => {
  const target = author("unlink");
  await setExternalFollow(otherId, target.id, true, target);
  await prisma.orm.public.Accounts.create({
    accountId: target.id,
    providerId: "bluesky",
    userId: otherId,
  });
  await prisma.orm.public.Accounts.where({
    providerId: "bluesky",
    userId: otherId,
  }).deleteAndCount();
  expect(await externalFollowState(otherId, target.id)).toBe(true);
  await setExternalFollow(otherId, target.id, false);
});
