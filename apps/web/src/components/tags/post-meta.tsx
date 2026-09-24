"use client";

import type { TagWithCount } from "@asm/db";
import { Hash } from "lucide-react";
import Link from "next/link";

import UserAvatar from "@/components/layouts/user/user-avatar";
import { extractInlineMeta } from "@/lib/posts/inline-meta";

// Accept the payload shapes produced by getPostDataInclude (post.mentions[*].
// user and post.tags) directly, so callers don't need unchecked casts.
interface PostMetaMention {
  avatarUrl: string | null;
  displayName: string | null;
  id: string;
  username: string;
}

interface PostMetaProps {
  mentions: (PostMetaMention | null | undefined)[];
  tags: Pick<TagWithCount, "name">[];
  // When provided, mentions/tags that already appear inline in the content
  // are dropped: they render in the post text itself, so showing them again
  // as chips would duplicate the row. Chips remain for relations added
  // explicitly through the edit dialogs.
  content?: string;
}

export const PostMeta = ({ mentions, tags, content }: PostMetaProps) => {
  const inline = content ? extractInlineMeta(content) : null;
  const validMentions = mentions.filter((user): user is PostMetaMention =>
    Boolean(user?.id && user.username)
  );
  const visibleMentions = inline
    ? validMentions.filter(
        (user) => !inline.usernames.has(user.username.toLowerCase())
      )
    : validMentions;
  const visibleTags = inline
    ? tags.filter((tag) => !inline.tags.has(tag.name.toLowerCase()))
    : tags;

  const hasTags = visibleTags.length > 0;
  const hasMentions = visibleMentions.length > 0;

  if (!(hasTags || hasMentions)) {
    return null;
  }

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {hasTags
        ? visibleTags.map((tag) => (
            <Link
              className="meta-chip meta-chip-tag"
              href={`/hashtag/${tag.name}`}
              key={tag.name}
            >
              <Hash className="meta-chip-accent h-3.5 w-3.5" />
              <span className="truncate">{tag.name}</span>
            </Link>
          ))
        : null}

      {hasMentions
        ? visibleMentions.map((user) => (
            <Link
              className="meta-chip meta-chip-mention"
              href={`/users/${user.username}`}
              key={user.id}
            >
              <UserAvatar avatarUrl={user.avatarUrl} className="h-4 w-4" />
              <span className="truncate">
                {user.displayName || user.username}
              </span>
            </Link>
          ))
        : null}
    </div>
  );
};
