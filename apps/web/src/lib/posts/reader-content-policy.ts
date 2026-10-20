import { findVisiblePost, prisma } from "@asm/db";
import { postHasExplicitMedia } from "@asm/protocols/discovery";

import { parseStoredEmbeds } from "@/lib/link-embeds/shared";
import { mediaContentIsExplicit } from "@/lib/media/media-content-policy";

import { explicitContentEnabled } from "./explicit-content-enabled";

interface ReadableContent {
  content?: string | null;
  explicitContent?: boolean;
  moderated?: boolean;
  semanticTags?: readonly string[] | null;
  tags?: readonly { name: string }[];
  attachments?: readonly { id?: string; altText?: string | null }[];
  embeds?: unknown;
}

export function postContentReadable(
  post: ReadableContent,
  includeExplicit: boolean
) {
  return (
    !post.moderated &&
    (includeExplicit ||
      (!postHasExplicitMedia(post) &&
        !parseStoredEmbeds(post.embeds).some((embed) =>
          postHasExplicitMedia({
            content: `${embed.title ?? ""} ${embed.description ?? ""}`,
          })
        )))
  );
}

export function postsForReader<
  T extends ReadableContent & { parentPost?: ReadableContent | null },
>(posts: T[], includeExplicit: boolean): T[] {
  return posts
    .filter((post) => postContentReadable(post, includeExplicit))
    .map((post) =>
      post.parentPost && !postContentReadable(post.parentPost, includeExplicit)
        ? { ...post, parentPost: null }
        : post
    );
}

export async function findReadableThreadAnchor(
  postId: string,
  viewerId: string
) {
  const anchor = await findVisiblePost(postId, viewerId);
  if (!anchor) {
    return null;
  }
  const post = await prisma.orm.public.Posts.where({ id: anchor.id })
    .select("content", "semanticTags", "explicitContent", "moderated")
    .include("user", (user) => user.select("banned"))
    .first();
  return post &&
    !post.user?.banned &&
    postContentReadable(post, await explicitContentEnabled(viewerId))
    ? anchor
    : null;
}

// Keep thread structure while withholding unsafe comment text and its media preview.
export async function commentsForReader<
  T extends { id: string; content: string; deleted: boolean },
>(comments: T[], includeExplicit: boolean): Promise<T[]> {
  if (includeExplicit || !comments.length) {
    return comments;
  }
  const media = await prisma.orm.public.PostMedia.where((item) =>
    item.commentId.in(comments.map((comment) => comment.id))
  )
    .select("commentId", "safety", "altText", "ocrText")
    .all();
  const hidden = new Set(
    media.filter(mediaContentIsExplicit).map((item) => item.commentId)
  );
  return comments.map((comment) =>
    hidden.has(comment.id) || postHasExplicitMedia(comment)
      ? { ...comment, content: "", deleted: true }
      : comment
  );
}
