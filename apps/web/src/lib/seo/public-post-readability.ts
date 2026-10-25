import { postContentReadable } from "@/lib/posts/reader-content-policy";

export function publicPostReadable(post: {
  content?: string | null;
  explicitContent?: boolean;
  semanticTags?: readonly string[] | null;
  embeds?: unknown;
  postMedias?: readonly { altText?: string | null }[];
  postToTags?: readonly { tag: { name: string } | null }[];
}) {
  return postContentReadable(
    {
      ...post,
      attachments: post.postMedias,
      tags: post.postToTags?.flatMap((link) => (link.tag ? [link.tag] : [])),
    },
    false
  );
}
