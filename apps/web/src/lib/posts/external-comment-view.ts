import type { CommentData } from "@asm/db";
import type { ExternalCommentPage } from "@asm/protocols/discovery";

import { externalAuthorView } from "./presentation";

export function externalCommentView(
  comment: ExternalCommentPage["items"][number],
  uri: string
): CommentData {
  return {
    ...comment,
    aura: 0,
    createdAt: new Date(comment.createdAt),
    creationAura: 0,
    parentId: null,
    postId: uri,
    postReceivedAura: 0,
    receivedAura: 0,
    rootId: null,
    user: externalAuthorView({
      ...comment.user,
      avatarUrl: comment.user.avatarUrl ?? undefined,
      handle: comment.user.username,
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url: `/users/${comment.user.username}`,
    }),
    vote: [],
  };
}
