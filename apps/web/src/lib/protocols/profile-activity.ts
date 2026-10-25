import {
  and,
  externalPostStates,
  filterExternalMediaSafety,
  fromPrismaDateTime,
  prisma,
  readNetworkPreferences,
} from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import {
  defaultNetworkPreferences,
  externalNetworkPostAllowed,
  externalPostSchema,
  postHasExplicitMedia,
  matchesAvoidedTopic,
} from "@asm/protocols/discovery";
import type { z } from "zod";

import type {
  profileActivityCursorSchema,
  ExternalProfileActivityItem,
} from "./profile-activity-schema";
import { readBlueskyPosts } from "./service";

export { profileActivityCursorSchema } from "./profile-activity-schema";
export type { ExternalProfileActivityItem } from "./profile-activity-schema";

export async function profileExternalActivity(
  userId: string,
  viewerId: string,
  kind: "amplified" | "eddies",
  signal: AbortSignal,
  cursor?: z.infer<typeof profileActivityCursorSchema>
) {
  let amplifiedQuery = prisma.orm.public.ExternalEngagements.where((entry) =>
    and(entry.userId.eq(userId), entry.amplified.eq(true))
  )
    .select("externalPostId", "amplifiedAt")
    .include("externalPost", (post) =>
      post.select("uri", "snapshot", "available", "checkedAt")
    )
    .orderBy([
      (entry) => entry.amplifiedAt.desc(),
      (entry) => entry.externalPostId.desc(),
    ]);
  let commentsQuery = prisma.orm.public.ExternalComments.where((entry) =>
    and(entry.userId.eq(userId), entry.deleted.eq(false))
  )
    .select("id", "createdAt", "content")
    .include("user", (user) =>
      user.select("id", "username", "displayName", "avatarUrl")
    )
    .include("externalPost", (post) =>
      post.select("uri", "snapshot", "available", "checkedAt")
    )
    .orderBy([(entry) => entry.createdAt.desc(), (entry) => entry.id.desc()]);
  if (cursor) {
    amplifiedQuery = amplifiedQuery.cursor({
      amplifiedAt: new Date(cursor.at),
      externalPostId: cursor.id,
    });
    commentsQuery = commentsQuery.cursor({
      createdAt: new Date(cursor.at),
      id: cursor.id,
    });
  }
  const amplifiedRows =
    kind === "amplified" ? await amplifiedQuery.limit(21).all() : [];
  const commentRows =
    kind === "eddies" ? await commentsQuery.limit(21).all() : [];
  const rows =
    kind === "amplified"
      ? amplifiedRows.map((entry) => ({
          at: fromPrismaDateTime(entry.amplifiedAt).toISOString(),
          comment: undefined,
          externalPost: entry.externalPost,
          id: entry.externalPostId,
        }))
      : commentRows.map((entry) => ({
          at: fromPrismaDateTime(entry.createdAt).toISOString(),
          comment: { content: entry.content, id: entry.id, user: entry.user },
          externalPost: entry.externalPost,
          id: entry.id,
        }));
  const page = rows.slice(0, 20);
  const stored = page.flatMap((row) =>
    row.externalPost ? [row.externalPost] : []
  );
  const posts = new Map<string, ExternalPost>();
  for (const entry of stored) {
    const parsed = externalPostSchema.safeParse(entry.snapshot);
    if (entry.available && parsed.success && parsed.data.id === entry.uri) {
      posts.set(entry.uri, parsed.data);
    }
  }
  const stale = stored.filter(
    (entry) =>
      entry.available &&
      Date.now() - fromPrismaDateTime(entry.checkedAt).getTime() > 60_000
  );
  if (stale.length) {
    try {
      const current = await readBlueskyPosts(
        [...new Set(stale.map((entry) => entry.uri))],
        AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        undefined,
        false,
        true
      );
      for (const entry of stale) {
        posts.delete(entry.uri);
      }
      for (const post of current) {
        posts.set(post.id, post);
      }
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      // A source outage keeps retained references readable without reviving known missing posts.
    }
  }
  const settings = viewerId ? await readNetworkPreferences(viewerId) : null;
  const preferences = settings?.preferences ?? defaultNetworkPreferences();
  const allowed = [...posts.values()].filter((post) =>
    externalNetworkPostAllowed(post, preferences)
  );
  const safe = preferences.showExplicitContent
    ? allowed
    : await filterExternalMediaSafety(allowed);
  const states = await externalPostStates(
    safe.map((post) => post.id),
    viewerId
  );
  const visible = new Map(
    safe.map((post) => [post.id, { ...post, asm: states.get(post.id) }])
  );
  const items: ExternalProfileActivityItem[] = page.flatMap((row) =>
    row.externalPost
      ? [
          {
            createdAt: row.at,
            id: row.id,
            post: visible.get(row.externalPost.uri) ?? null,
            uri: row.externalPost.uri,
            ...(row.comment
              ? {
                  comment: {
                    ...row.comment,
                    ...((!preferences.showExplicitContent &&
                      postHasExplicitMedia({ content: row.comment.content })) ||
                    matchesAvoidedTopic(
                      row.comment.content,
                      [],
                      preferences.avoidedTopics
                    )
                      ? { content: "", withheld: true }
                      : {}),
                  },
                }
              : {}),
          },
        ]
      : []
  );
  const last = page.at(-1);
  return {
    items,
    nextCursor: rows.length > 20 && last ? { at: last.at, id: last.id } : null,
  };
}
