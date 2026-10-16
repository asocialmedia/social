import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import prisma, { toPrismaDateTime } from "../prisma";
import {
  accountCredentialFingerprint,
  resolveAccountCollision,
} from "./account-resolution";
import {
  createAccountResolutionState,
  readAccountResolutionState,
} from "./account-resolution-state";

const createdUsers: string[] = [];

beforeAll(() => {
  const host = new URL(process.env.DATABASE_URL ?? "http://invalid").hostname;
  if (!["localhost", "127.0.0.1"].includes(host)) {
    throw new Error("Local test database required");
  }
});

afterAll(async () => {
  await prisma.orm.public.Users.where((row) =>
    row.id.in(createdUsers)
  ).deleteAndCount();
});

async function fixture() {
  const current = randomUUID();
  const other = randomUUID();
  const third = randomUUID();
  const id = randomUUID();
  const expiresAt = toPrismaDateTime(new Date(Date.now() + 60_000));
  createdUsers.push(current, other, third);
  await prisma.orm.public.Users.createAll(
    [current, other, third].map((userId) => ({
      displayName: userId,
      email: `${userId}@example.test`,
      emailVerified: true,
      id: userId,
      username: `resolve_${userId}`,
    }))
  );
  await prisma.orm.public.Accounts.createAll(
    [current, other].map((userId) => ({
      accountId: userId,
      password: "fixture-password-hash",
      providerId: "credential",
      userId,
    }))
  );
  await prisma.orm.public.Accounts.create({
    accountId: id,
    providerId: "reddit",
    userId: other,
  });
  const session = await prisma.orm.public.Sessions.create({
    expiresAt,
    token: randomUUID(),
    userId: current,
  });
  const expectedState = JSON.stringify({ current, id, other });
  await createAccountResolutionState(
    id,
    current,
    expectedState,
    new Date(Date.now() + 60_000)
  );
  const fingerprintCurrent = await accountCredentialFingerprint(current);
  const fingerprintOther = await accountCredentialFingerprint(other);
  if (!fingerprintCurrent || !fingerprintOther) {
    throw new Error("Missing fixture credentials");
  }
  const input = {
    confirmation: `resolve_${other}`,
    currentUserId: current,
    expectedState,
    fingerprints: { [current]: fingerprintCurrent, [other]: fingerprintOther },
    id,
    keepUserId: current,
    mode: "merge" as const,
    otherUserId: other,
    provider: { accountId: id, id: "reddit" },
    sessionId: session.id,
  };
  return { current, id, input, other, third };
}

describe("transactional account resolution", () => {
  test("moves public content and OAuth identities, deduplicates relationships, preserves canonical credentials, and consumes once", async () => {
    const f = await fixture();
    const post = await prisma.orm.public.Posts.create({
      content: "Merge regression",
      userId: f.other,
    });
    const comment = await prisma.orm.public.Comments.create({
      content: "Preserve this comment",
      postId: post.id,
      userId: f.other,
    });
    await prisma.orm.public.Bookmarks.createAll(
      [f.current, f.other].map((userId) => ({ postId: post.id, userId }))
    );
    await prisma.orm.public.Follows.createAll([
      { followerId: f.current, followingId: f.third },
      { followerId: f.other, followingId: f.third },
      { followerId: f.third, followingId: f.other },
      { followerId: f.current, followingId: f.other },
    ]);
    await resolveAccountCollision(f.input);
    expect(
      await prisma.orm.public.Users.where({ id: f.other }).first()
    ).toBeNull();
    const verifiedRow1 = await prisma.orm.public.Posts.where({
      id: post.id,
    }).first();
    expect(verifiedRow1?.userId).toBe(f.current);
    const mergedComment = await prisma.orm.public.Comments.where({
      id: comment.id,
    }).first();
    expect(mergedComment?.userId).toBe(f.current);
    expect(
      await prisma.orm.public.Bookmarks.where({ userId: f.current }).all()
    ).toHaveLength(1);
    expect(
      await prisma.orm.public.Follows.where({
        followerId: f.current,
        followingId: f.current,
      }).all()
    ).toHaveLength(0);
    expect(
      await prisma.orm.public.Follows.where({
        followerId: f.current,
        followingId: f.third,
      }).all()
    ).toHaveLength(1);
    const verifiedRow2 = await prisma.orm.public.Accounts.where({
      accountId: f.id,
      providerId: "reddit",
    }).first();
    expect(verifiedRow2?.userId).toBe(f.current);
    expect(
      await prisma.orm.public.Accounts.where({
        providerId: "credential",
        userId: f.current,
      }).all()
    ).toHaveLength(1);
    const verifiedRow3 = await prisma.orm.public.Users.where({
      id: f.current,
    }).first();
    expect(verifiedRow3?.email).toBe(`${f.current}@example.test`);
    expect(
      await prisma.orm.public.Sessions.where({ userId: f.current }).all()
    ).toHaveLength(0);
    expect(await readAccountResolutionState(f.id)).toBeNull();
    const verifiedRow4 = await prisma.orm.public.UsernameAliases.where({
      username: `resolve_${f.other}`,
    }).first();
    expect(verifiedRow4?.userId).toBe(f.current);
    await expect(resolveAccountCollision(f.input)).rejects.toThrow("expired");
  });

  test("can keep the linked account and discard the initiating account only after naming it", async () => {
    const f = await fixture();
    const post = await prisma.orm.public.Posts.create({
      content: "Explicitly discarded",
      userId: f.current,
    });
    await resolveAccountCollision({
      ...f.input,
      confirmation: `resolve_${f.current}`,
      keepUserId: f.other,
      mode: "discard",
    });
    expect(
      await prisma.orm.public.Posts.where({ id: post.id }).first()
    ).toBeNull();
    expect(
      await prisma.orm.public.Users.where({ id: f.current }).first()
    ).toBeNull();
    expect(
      await prisma.orm.public.Users.where({ id: f.other }).first()
    ).not.toBeNull();
  });

  test("a changed password rolls back every transfer and leaves the review available", async () => {
    const f = await fixture();
    await prisma.orm.public.Accounts.where({
      providerId: "credential",
      userId: f.other,
    }).updateAndCount({ password: "changed-password" });
    await expect(resolveAccountCollision(f.input)).rejects.toThrow(
      "sign-in details changed"
    );
    expect(
      await prisma.orm.public.Users.where({ id: f.other }).first()
    ).not.toBeNull();
    const retainedProvider = await prisma.orm.public.Accounts.where({
      accountId: f.id,
    }).first();
    expect(retainedProvider?.userId).toBe(f.other);
    expect(await readAccountResolutionState(f.id)).toBe(f.input.expectedState);
  });

  test("encrypted conversation ownership is never rewritten during a merge", async () => {
    const f = await fixture();
    const conversation = await prisma.orm.public.MessageConversations.create(
      {}
    );
    await prisma.orm.public.MessageConversationMembers.create({
      conversationId: conversation.id,
      userId: f.other,
    });
    try {
      await expect(resolveAccountCollision(f.input)).rejects.toThrow(
        "encrypted conversations"
      );
      const retainedMember =
        await prisma.orm.public.MessageConversationMembers.where({
          conversationId: conversation.id,
          userId: f.other,
        }).first();
      expect(retainedMember?.userId).toBe(f.other);
      expect(
        await prisma.orm.public.Users.where({ id: f.other }).first()
      ).not.toBeNull();
    } finally {
      await prisma.orm.public.MessageConversations.where({
        id: conversation.id,
      }).deleteAndCount();
    }
  });

  test("missing credentials and incorrect confirmations cannot delete an account", async () => {
    const f = await fixture();
    await expect(
      resolveAccountCollision({ ...f.input, confirmation: "wrong" })
    ).rejects.toThrow("exact username");
    await prisma.orm.public.Users.where({ id: f.other }).updateAndCount({
      emailVerified: false,
    });
    const fingerprint = await accountCredentialFingerprint(f.other);
    await expect(
      resolveAccountCollision({
        ...f.input,
        fingerprints: { ...f.input.fingerprints, [f.other]: fingerprint ?? "" },
      })
    ).rejects.toThrow("verified email");
    expect(
      await prisma.orm.public.Users.where({ id: f.other }).first()
    ).not.toBeNull();
  });

  test("concurrent resolutions commit only once", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      resolveAccountCollision(f.input),
      resolveAccountCollision(f.input),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
  });
});
