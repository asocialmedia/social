import {
  getCommentDataQuery,
  getPostDataQuery,
  hydrateViewCounts,
  mapCommentData,
  mapPostData,
  prisma,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import type { Media } from "@/lib/types";

export type UserReplyData = ReturnType<typeof mapCommentData> & {
  attachments: Media[];
  parent: { user: { username: string } | null } | null;
  post: ReturnType<typeof mapPostData>;
  votes: ReturnType<typeof mapCommentData>["vote"];
};

export interface UserRepliesPage {
  nextCursor: string | null;
  replies: UserReplyData[];
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const pageSize = 20;
  const { userId } = await ctx.params;

  let query = getCommentDataQuery(prisma.orm, user.id)
    .include("postMedias", (media) =>
      media.select(
        "aiGenerated",
        "altText",
        "height",
        "id",
        "_type",
        "mimeType",
        "thumbnailKey",
        "transcript",
        "width"
      )
    )
    .include("parent", (parent) =>
      parent
        .select("id")
        .include("user", (relatedUser) => relatedUser.select("username"))
    )
    .include("post", (_post) => getPostDataQuery(prisma.orm, user.id))
    .where({ userId })
    .orderBy((comment) => comment.createdAt.desc());
  if (cursor) {
    query = query.cursor({ id: cursor }).offset(1);
  }
  const comments = await query.limit(pageSize + 1).all();

  const replies = comments.slice(0, pageSize).flatMap((reply) => {
    if (!reply.post) {
      return [];
    }
    const mappedComment = mapCommentData(reply);
    return [
      {
        ...mappedComment,
        attachments: reply.postMedias.map((media) => ({
          aiGenerated: media.aiGenerated,
          altText: media.altText,
          height: media.height,
          id: media.id,
          mimeType: media.mimeType,
          thumbnailKey: media.thumbnailKey,
          transcript: media.transcript,
          type: media._type,
          width: media.width,
        })),
        parent: reply.parent,
        post: mapPostData(reply.post),
        votes: mappedComment.vote,
      },
    ];
  });
  const hydratedPosts = await hydrateViewCounts(
    replies.map((reply) => reply.post)
  );

  const repliesWithHydratedPosts = replies.map((reply, index) => ({
    ...reply,
    post: hydratedPosts[index] ?? reply.post,
  }));

  const nextCursor = comments.length > pageSize ? comments[pageSize].id : null;
  const data: UserRepliesPage = {
    nextCursor,
    replies: repliesWithHydratedPosts,
  };
  return Response.json(data);
}
