import type { ExternalAuthor } from "@asm/protocols/contracts";

import followsSql from "../../sql/protocols/external-follows.sql" with { type: "text" };
import { fromPrismaDateTime, toPrismaDateTime } from "../dates";
import { rawExecute } from "../messages/infrastructure/raw-sql";
import { readSqlBundle } from "../messages/infrastructure/sql-template";
import prisma from "../prisma";

const { follows: sql } = readSqlBundle(followsSql, {
  follows: ["lock", "prune", "scrub"],
});
export const MAX_EXTERNAL_FOLLOWS = 100;
export const MAX_TRACKED_EXTERNAL_AUTHORS = 16_000;

export class ExternalFollowError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = "ExternalFollowError";
    this.status = status;
    this.code = code;
  }
}

export async function externalFollowState(userId: string, authorDid: string) {
  return Boolean(
    await prisma.orm.public.ExternalFollows.where({ authorDid, userId }).first()
  );
}

export async function externalFollowAuthors(userId: string) {
  const rows = await prisma.orm.public.ExternalFollows.where({ userId })
    .include("author")
    .orderBy((row) => row.authorDid.asc())
    .limit(MAX_EXTERNAL_FOLLOWS)
    .all();
  return rows.map((row) => ({
    ...row.author,
    followedAt: fromPrismaDateTime(row.createdAt).toISOString(),
  }));
}

export function setExternalFollow(
  userId: string,
  authorDid: string,
  active: boolean,
  author?: ExternalAuthor
) {
  return prisma.transaction(async (tx) => {
    await rawExecute(sql.lock, [], tx);
    const user = await tx.orm.public.Users.where({ id: userId })
      .select("banned", "banExpires")
      .first();
    if (
      !user ||
      (user.banned &&
        (!user.banExpires ||
          fromPrismaDateTime(user.banExpires).getTime() > Date.now()))
    ) {
      throw new ExternalFollowError(403, "account_restricted");
    }
    const existing = await tx.orm.public.ExternalFollows.where({
      authorDid,
      userId,
    }).first();
    if (!active) {
      await tx.orm.public.ExternalFollows.where({
        authorDid,
        userId,
      }).deleteAndCount();
      // A shared author stays while any ASM user follows it.
      await rawExecute(sql.prune, [], tx);
      return false;
    }
    if (existing) {
      return true;
    }
    if (!author || author.source !== "bluesky" || author.id !== authorDid) {
      throw new ExternalFollowError(400, "invalid_author");
    }
    const personal = await tx.orm.public.ExternalFollows.where({ userId })
      .select("authorDid")
      .limit(MAX_EXTERNAL_FOLLOWS)
      .all();
    if (personal.length >= MAX_EXTERNAL_FOLLOWS) {
      throw new ExternalFollowError(409, "follow_limit");
    }
    const reference = await tx.orm.public.ExternalAuthors.where({
      did: authorDid,
    }).first();
    if (reference && reference.status !== "active") {
      throw new ExternalFollowError(409, "author_inactive");
    }
    if (!reference) {
      const total = await tx.orm.public.ExternalAuthors.aggregate((a) => ({
        count: a.count(),
      }));
      if (total.count >= MAX_TRACKED_EXTERNAL_AUTHORS) {
        throw new ExternalFollowError(503, "tracking_capacity");
      }
      await tx.orm.public.ExternalAuthors.create({
        did: authorDid,
        displayName: author.displayName,
        handle: author.handle,
      });
    }
    await tx.orm.public.ExternalFollows.create({ authorDid, userId });
    return true;
  });
}

export function externalFollowRegistry() {
  return prisma.transaction(async (tx) => {
    await rawExecute(sql.lock, [], tx);
    await rawExecute(sql.prune, [], tx);
    const authors = await tx.orm.public.ExternalAuthors.select("did")
      .orderBy((row) => row.did.asc())
      .limit(MAX_TRACKED_EXTERNAL_AUTHORS)
      .all();
    const reconcile = await tx.orm.public.ExternalAuthors.select("did")
      .where((row) => row.nextCheckAt.lte(toPrismaDateTime(new Date())))
      .orderBy((row) => row.nextCheckAt.asc())
      .limit(20)
      .all();
    return {
      dids: authors.map((a) => a.did),
      reconcile: reconcile.map((a) => a.did),
    };
  });
}

// Only the authenticated protocol service supplies verified relay status here.
// Unknown, missing, timed-out, and migrated repositories never imply deletion.
export function reconcileExternalAuthor(input: {
  did: string;
  status: string;
  handle?: string;
  displayName?: string;
}) {
  return prisma.transaction(async (tx) => {
    await rawExecute(sql.lock, [], tx);
    if (input.status === "deleted") {
      await rawExecute(sql.scrub, [input.did], tx);
      await tx.orm.public.ExternalAuthors.where({
        did: input.did,
      }).deleteAndCount();
      return;
    }
    const author = await tx.orm.public.ExternalAuthors.where({
      did: input.did,
    }).first();
    if (!author) {
      return;
    }
    await tx.orm.public.ExternalAuthors.where({ did: input.did }).update({
      ...(input.status === "unknown" ? {} : { status: input.status }),
      ...(input.handle ? { handle: input.handle } : {}),
      ...(input.displayName === undefined
        ? {}
        : { displayName: input.displayName }),
      nextCheckAt: toPrismaDateTime(
        new Date(
          Date.now() +
            (input.status === "active" ? 6 * 60 * 60_000 : 15 * 60_000)
        )
      ),
    });
    if (input.status !== "active" && input.status !== "unknown") {
      await rawExecute(sql.scrub, [input.did], tx);
    }
  });
}
