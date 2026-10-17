// oxlint-disable-next-line typescript/triple-slash-reference -- Workspace consumers need the SQL import declaration.
/// <reference path="../../sql.d.ts" />
import { createHash } from "node:crypto";

import type { ExternalPost } from "@asm/protocols/contracts";
import { externalPostSchema } from "@asm/protocols/discovery";
import { and } from "@prisma/orm-postgres/orm-client";
import { z } from "zod";

import externalInteractionsSql from "../../sql/protocols/external-interactions.sql" with { type: "text" };
import { getPostDataQuery, mapPostData } from "../client";
import { fromPrismaDateTime, toPrismaDateTime } from "../dates";
import { rawExecute } from "../messages/infrastructure/raw-sql";
import { readSqlBundle } from "../messages/infrastructure/sql-template";
import type { PrismaTransaction } from "../prisma";
import prisma from "../prisma";

const { interaction: interactionSql } = readSqlBundle(externalInteractionsSql, {
  interaction: ["lockTimeout", "statementTimeout", "lockPost"],
});

export function externalPostId(uri: string): string {
  return createHash("sha256").update(`bluesky:${uri}`).digest("hex");
}

export class ExternalInteractionError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = "ExternalInteractionError";
    this.status = status;
    this.code = code;
  }
}

function durableSnapshot(post: ExternalPost) {
  const serialized = JSON.stringify({ ...post, asm: undefined });
  return z.json().parse(JSON.parse(serialized));
}

export async function externalPostStates(uris: string[], viewer = "") {
  if (uris.length > 50) {
    throw new ExternalInteractionError(400, "too_many_posts");
  }
  if (uris.length === 0) {
    return new Map<string, NonNullable<ExternalPost["asm"]>>();
  }
  const rows = await prisma.orm.public.ExternalPosts.select("uri")
    .where((post) => post.id.in(uris.map(externalPostId)))
    .include("comments", (comments) =>
      comments.where({ deleted: false }).count()
    )
    .include("responses", (responses) => responses.count())
    .include("engagements", (engagements) =>
      engagements.combine({
        amplifications: engagements.where({ amplified: true }).count(),
        viewer: engagements
          .where({ userId: viewer })
          .select("amplified", "bookmarked")
          .limit(1),
      })
    )
    .all();
  return new Map(
    rows.map((row) => [
      row.uri,
      {
        amplifications: row.engagements.amplifications,
        amplified: row.engagements.viewer[0]?.amplified ?? false,
        bookmarked: row.engagements.viewer[0]?.bookmarked ?? false,
        comments: row.comments,
        responses: row.responses,
      },
    ])
  );
}

export async function findExternalPost(uri: string) {
  return await prisma.orm.public.ExternalPosts.where({
    id: externalPostId(uri),
  }).first();
}

export async function retainExternalResponse(
  tx: PrismaTransaction,
  post: ExternalPost,
  userId: string
) {
  await rawExecute(interactionSql.lockTimeout, [], tx);
  await rawExecute(interactionSql.statementTimeout, [], tx);
  await rawExecute(
    interactionSql.lockPost,
    [`external-post:${externalPostId(post.id)}`],
    tx
  );
  const user = await tx.orm.public.Users.select("banned", "banExpires")
    .where({ id: userId })
    .first();
  if (
    !user ||
    (user.banned &&
      (!user.banExpires ||
        fromPrismaDateTime(user.banExpires).getTime() > Date.now()))
  ) {
    throw new ExternalInteractionError(403, "account_restricted");
  }
  const snapshot = externalPostSchema.parse(post);
  if (
    !snapshot.id.startsWith(`at://${snapshot.author.id}/app.bsky.feed.post/`)
  ) {
    throw new ExternalInteractionError(400, "identity_mismatch");
  }
  const id = externalPostId(snapshot.id);
  const data = {
    available: true,
    checkedAt: toPrismaDateTime(new Date()),
    snapshot: durableSnapshot(snapshot),
  };
  if (Buffer.byteLength(JSON.stringify(data.snapshot)) > 65_536) {
    throw new ExternalInteractionError(413, "post_too_large");
  }
  await tx.orm.public.ExternalPosts.upsert({
    conflictOn: { id },
    create: {
      ...data,
      authorId: snapshot.author.id,
      id,
      source: "bluesky",
      uri: snapshot.id,
    },
    update: data,
  });
  return id;
}

export async function externalResponses(
  uri: string,
  viewer: string,
  after?: { createdAt: string; id: string }
) {
  let query = getPostDataQuery(prisma.orm, viewer)
    .where({ communityId: null, externalParentId: externalPostId(uri) })
    .orderBy([(post) => post.createdAt.asc(), (post) => post.id.asc()])
    .limit(31);
  if (after) {
    query = query.cursor({
      createdAt: toPrismaDateTime(new Date(after.createdAt)),
      id: after.id,
    });
  }
  const rows = await query.all();
  const items = rows.slice(0, 30).map(mapPostData);
  const last = items.at(-1);
  return {
    cursor:
      rows.length > 30 && last
        ? { createdAt: last.createdAt.toISOString(), id: last.id }
        : null,
    items,
  };
}

export async function refreshExternalPost(
  uri: string,
  post: ExternalPost | null
) {
  await prisma.orm.public.ExternalPosts.where({
    id: externalPostId(uri),
  }).update({
    available: post !== null,
    checkedAt: toPrismaDateTime(new Date()),
    snapshot: post ? durableSnapshot(post) : null,
  });
}

export async function mutateExternalPost(input: {
  userId: string;
  uri: string;
  post?: ExternalPost;
  action: "bookmark" | "amplify" | "comment" | "delete_comment";
  active?: boolean;
  content?: string;
  requestId?: string;
  commentId?: string;
}) {
  const id = externalPostId(input.uri);
  const snapshot = input.post
    ? externalPostSchema.parse(input.post)
    : undefined;
  if (
    snapshot &&
    (snapshot.id !== input.uri ||
      !input.uri.startsWith(`at://${snapshot.author.id}/app.bsky.feed.post/`))
  ) {
    throw new ExternalInteractionError(400, "identity_mismatch");
  }
  if (snapshot && Buffer.byteLength(JSON.stringify(snapshot)) > 65_536) {
    throw new ExternalInteractionError(413, "post_too_large");
  }
  await prisma.transaction(async (tx) => {
    await rawExecute(interactionSql.lockTimeout, [], tx);
    await rawExecute(interactionSql.statementTimeout, [], tx);
    // The canonical URI and primary key are both unique; serialize first inserts across either index.
    await rawExecute(interactionSql.lockPost, [`external-post:${id}`], tx);
    const user = await tx.orm.public.Users.select("banned", "banExpires")
      .where({ id: input.userId })
      .first();
    if (
      !user ||
      (user.banned &&
        (!user.banExpires ||
          fromPrismaDateTime(user.banExpires).getTime() > Date.now()))
    ) {
      throw new ExternalInteractionError(403, "account_restricted");
    }
    if (snapshot) {
      const data = {
        available: true,
        checkedAt: toPrismaDateTime(new Date()),
        snapshot: durableSnapshot(snapshot),
      };
      await tx.orm.public.ExternalPosts.upsert({
        conflictOn: { id },
        create: {
          ...data,
          authorId: snapshot.author.id,
          id,
          source: "bluesky",
          uri: input.uri,
        },
        update: data,
      });
    } else {
      const existing = await tx.orm.public.ExternalPosts.select("id")
        .where({ id })
        .first();
      if (!existing) {
        const authorDid = input.uri.replace("at://", "").split("/")[0] ?? "";
        await tx.orm.public.ExternalPosts.upsert({
          conflictOn: { id },
          create: {
            authorId: authorDid,
            available: true,
            checkedAt: toPrismaDateTime(new Date()),
            id,
            snapshot: null,
            source: "bluesky",
            uri: input.uri,
          },
          update: {},
        });
      }
    }
    if (input.action === "delete_comment") {
      await tx.orm.public.ExternalComments.where((comment) =>
        and(
          comment.id.eq(input.commentId ?? ""),
          comment.userId.eq(input.userId),
          comment.externalPostId.eq(id)
        )
      ).update({ content: "", deleted: true });
    } else if (input.action === "comment") {
      if (
        !input.requestId ||
        !input.content?.trim() ||
        input.content.length > 1500
      ) {
        throw new ExternalInteractionError(400, "invalid_comment");
      }
      const existing = await tx.orm.public.ExternalComments.where({
        requestId: input.requestId,
        userId: input.userId,
      }).first();
      if (
        existing &&
        (existing.externalPostId !== id ||
          existing.content !== input.content.trim())
      ) {
        throw new ExternalInteractionError(409, "idempotency_conflict");
      }
      const saved = await tx.orm.public.ExternalComments.upsert({
        conflictOn: { requestId: input.requestId, userId: input.userId },
        create: {
          content: input.content.trim(),
          externalPostId: id,
          requestId: input.requestId,
          userId: input.userId,
        },
        update: {},
      });
      if (
        saved.externalPostId !== id ||
        saved.content !== input.content.trim()
      ) {
        throw new ExternalInteractionError(409, "idempotency_conflict");
      }
    } else {
      const update =
        input.action === "bookmark"
          ? { bookmarked: input.active === true }
          : { amplified: input.active === true };
      await tx.orm.public.ExternalEngagements.upsert({
        conflictOn: { externalPostId: id, userId: input.userId },
        create: {
          amplified: false,
          bookmarked: false,
          externalPostId: id,
          userId: input.userId,
          ...update,
        },
        update: { ...update, updatedAt: toPrismaDateTime(new Date()) },
      });
    }
  });
  const states = await externalPostStates([input.uri], input.userId);
  return (
    states.get(input.uri) ?? {
      amplifications: 0,
      amplified: false,
      bookmarked: false,
      comments: 0,
    }
  );
}

export async function externalComments(
  uri: string,
  after?: { createdAt: string; id: string }
) {
  let query = prisma.orm.public.ExternalComments.where({
    externalPostId: externalPostId(uri),
  })
    .select("id", "content", "userId", "createdAt", "deleted")
    .include("user", (user) =>
      user.select("id", "username", "displayName", "avatarUrl")
    )
    .orderBy([
      (comment) => comment.createdAt.asc(),
      (comment) => comment.id.asc(),
    ])
    .limit(31);
  if (after) {
    query = query.cursor({
      createdAt: toPrismaDateTime(new Date(after.createdAt)),
      id: after.id,
    });
  }
  const rows = await query.all();
  const items = rows.slice(0, 30).map((row) => ({
    ...row,
    createdAt: fromPrismaDateTime(row.createdAt).toISOString(),
  }));
  const last = items.at(-1);
  return {
    cursor:
      rows.length > 30 && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
    items,
  };
}

export async function externalLibrary(
  userId: string,
  kind: "bookmarks" | "amplified",
  after?: { updatedAt: string; externalPostId: string }
) {
  let query = prisma.orm.public.ExternalEngagements.where((entry) =>
    and(
      entry.userId.eq(userId),
      kind === "bookmarks"
        ? entry.bookmarked.eq(true)
        : entry.amplified.eq(true)
    )
  )
    .select("externalPostId", "updatedAt")
    .include("externalPost", (post) =>
      post.select("uri", "snapshot", "available", "checkedAt")
    )
    .orderBy([
      (entry) => entry.updatedAt.desc(),
      (entry) => entry.externalPostId.desc(),
    ])
    .limit(21);
  if (after) {
    query = query.cursor({
      externalPostId: after.externalPostId,
      updatedAt: new Date(after.updatedAt),
    });
  }
  const rows = await query.all();
  const items = rows.slice(0, 20).flatMap((row) =>
    row.externalPost
      ? [
          {
            ...row.externalPost,
            checkedAt: fromPrismaDateTime(
              row.externalPost.checkedAt
            ).toISOString(),
          },
        ]
      : []
  );
  const last = rows.slice(0, 20).at(-1);
  return {
    cursor:
      rows.length > 20 && last
        ? {
            externalPostId: last.externalPostId,
            updatedAt: fromPrismaDateTime(last.updatedAt).toISOString(),
          }
        : null,
    items,
  };
}

export async function upsertExternalPostSnapshot(
  post: ExternalPost
): Promise<string> {
  const snapshot = externalPostSchema.parse(post);
  const id = externalPostId(snapshot.id);
  const data = {
    available: true,
    checkedAt: toPrismaDateTime(new Date()),
    snapshot: durableSnapshot(snapshot),
  };
  await prisma.orm.public.ExternalPosts.upsert({
    conflictOn: { id },
    create: {
      ...data,
      authorId: snapshot.author.id,
      id,
      source: "bluesky",
      uri: snapshot.id,
    },
    update: data,
  });
  return id;
}

export async function recordExternalPostVisit(
  userId: string,
  post: ExternalPost
): Promise<string> {
  const id = await upsertExternalPostSnapshot(post);
  await prisma.orm.public.ExternalEngagements.upsert({
    conflictOn: { externalPostId: id, userId },
    create: {
      amplified: false,
      bookmarked: false,
      externalPostId: id,
      updatedAt: toPrismaDateTime(new Date()),
      userId,
    },
    update: {
      updatedAt: toPrismaDateTime(new Date()),
    },
  });
  return id;
}
