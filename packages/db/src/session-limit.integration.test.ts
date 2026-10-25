import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { toPrismaDateTime } from "./dates";
import prisma from "./prisma";
import {
  ACCOUNT_SESSION_LIMIT,
  enforceAccountSessionLimit,
} from "./session-limit";

const userId = `session-limit-${randomUUID()}`;
const otherUserId = `session-limit-other-${randomUUID()}`;
const expiresAt = toPrismaDateTime(new Date(Date.now() + 86_400_000));

beforeAll(async () => {
  await prisma.orm.public.Users.createAll(
    [userId, otherUserId].map((id) => ({
      displayName: id,
      email: `${id}@example.test`,
      id,
      username: id,
    }))
  );
});

afterAll(async () => {
  await prisma.orm.public.Users.where((user) =>
    user.id.in([userId, otherUserId])
  ).deleteAndCount();
});

describe("account session limit", () => {
  test("keeps the three newest active sign-ins across browser and native clients", async () => {
    const ids = Array.from({ length: 6 }, () => randomUUID());
    await prisma.orm.public.Sessions.createAll(
      ids.map((id, index) => ({
        createdAt: toPrismaDateTime(new Date(Date.now() - (6 - index) * 1000)),
        expiresAt,
        id,
        token: randomUUID(),
        userAgent: index % 2 ? "Asocialmedia/1 (Android 16; Pixel)" : "Chrome",
        userId,
      }))
    );
    const other = await prisma.orm.public.Sessions.create({
      expiresAt,
      token: randomUUID(),
      userId: otherUserId,
    });
    const revoked = await enforceAccountSessionLimit(userId);
    expect(revoked.toSorted()).toEqual(ids.slice(0, 3).toSorted());
    const retained = await prisma.orm.public.Sessions.select("id")
      .where({ userId })
      .all();
    expect(retained.map((session) => session.id).toSorted()).toEqual(
      ids.slice(3).toSorted()
    );
    expect(
      await prisma.orm.public.Sessions.where({ id: other.id }).first()
    ).not.toBeNull();
  });

  test("concurrent sign-ins settle at three sessions and pruning is idempotent", async () => {
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        await prisma.orm.public.Sessions.create({
          expiresAt,
          token: randomUUID(),
          userId,
        });
        await enforceAccountSessionLimit(userId);
      })
    );
    const sessions = await prisma.orm.public.Sessions.select("id")
      .where({ userId })
      .all();
    expect(sessions).toHaveLength(ACCOUNT_SESSION_LIMIT);
    expect(await enforceAccountSessionLimit(userId)).toEqual([]);
  });

  test("expired sessions do not evict active sign-ins", async () => {
    await prisma.orm.public.Sessions.createAll(
      Array.from({ length: 2 }, () => ({
        expiresAt,
        token: randomUUID(),
        userId: otherUserId,
      }))
    );
    const expired = await prisma.orm.public.Sessions.create({
      expiresAt: toPrismaDateTime(new Date(Date.now() - 1000)),
      token: randomUUID(),
      userId: otherUserId,
    });
    expect(await enforceAccountSessionLimit(otherUserId)).toEqual([]);
    const sessions = await prisma.orm.public.Sessions.select("id")
      .where({ userId: otherUserId })
      .all();
    expect(sessions).toHaveLength(4);
    expect(sessions.some((session) => session.id === expired.id)).toBe(true);
  });
});
