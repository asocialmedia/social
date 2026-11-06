import type { CommentData } from "@asm/db";
import type { ExternalCommentPage } from "@asm/protocols/discovery";

import { profilePath } from "@/lib/users/profile-path";

import { externalAuthorView } from "./presentation";

export function externalCommentView(
  comment: ExternalCommentPage["items"][number],
  uri: string
): CommentData & { source?: "asm" | "bluesky" } {
  const handle = comment.user.handle ?? comment.user.username;
  return {
    ...comment,
    aura: 0,
    createdAt: new Date(comment.createdAt),
    creationAura: 0,
    parentId: comment.parentId ?? null,
    postId: uri,
    postReceivedAura: 0,
    receivedAura: 0,
    rootId: comment.rootId ?? null,
    source: comment.source ?? "asm",
    user: externalAuthorView({
      ...comment.user,
      avatarUrl: comment.user.avatarUrl ?? undefined,
      handle,
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url:
        comment.source === "bluesky"
          ? `https://bsky.app/profile/${handle}`
          : profilePath(comment.user.username),
    }),
    vote: [],
  };
}
