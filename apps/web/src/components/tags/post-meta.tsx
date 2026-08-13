"use client";

import type { TagWithCount } from "@asm/db";
import { Hash } from "lucide-react";
import Link from "next/link";
import UserAvatar from "@/components/layouts/user-avatar";

// Accept the payload shapes produced by getPostDataInclude (post.mentions[*].
// user and post.tags) directly, so callers don't need unchecked casts.
interface PostMetaProps {
  mentions: Array<{
    avatarUrl: string | null;
    displayName: string | null;
    id: string;
    username: string;
  }>;
  tags: TagWithCount[];
}

export function PostMeta({ mentions, tags }: PostMetaProps) {
  const hasTags = tags.length > 0;
  const hasMentions = mentions.length > 0;

  if (!(hasTags || hasMentions)) {
    return null;
  }

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {hasTags
        ? tags.map((tag) => (
            <Link
              className="meta-chip meta-chip-tag"
              href={`/hashtag/${tag.name}`}
              key={tag.id}
            >
              <Hash className="meta-chip-accent h-3.5 w-3.5" />
              <span className="truncate">{tag.name}</span>
            </Link>
          ))
        : null}

      {hasMentions
        ? mentions.map((user) => (
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
}
