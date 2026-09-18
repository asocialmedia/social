// Access decisions for serving stored media objects. Media rows come in three
// flavors and each has a different audience:
//
//  post-linked   (postId set)      -> public; posts are publicly viewable in
//                                     feeds, so their attachments are too.
//  comment-linked(commentId set)   -> signed-in users only; comment threads
//                                     are only readable when authenticated.
//  message-linked(messageConver-   -> members of that conversation. Message
//  sationId set)                      attachments are never linked to a
//                                     post/comment by design; the sender binds
//                                     the row to the thread at upload and the
//                                     serving route resolves membership (see
//                                     message-media-access.ts).
//  unlinked      (abandoned drafts)-> owner only. Orphaned draft uploads belong
//                                     to their uploader until attached.
//
// The decision is pure so it can be unit-tested without a database. The
// caller resolves conversation membership; this function only applies it.

export interface MediaOwnership {
  postId: string | null;
  commentId: string | null;
  messageConversationId?: string | null;
  userId: string | null;
  isPrivateCommunityPost?: boolean;
}

export interface MediaViewer {
  id: string;
}

export interface MediaAccessOptions {
  // Whether the viewer is a member of media.messageConversationId (and not
  // blocked). Resolved by the caller via message-media-access.ts.
  isConversationMember?: boolean;
  // Whether the viewer is an active member of the private community hosting the post.
  isCommunityMember?: boolean;
}

export type MediaAccessDecision =
  | { allowed: true }
  | { allowed: false; status: 401 | 403 | 404 };

export function decideMediaAccess(
  media: MediaOwnership,
  viewer: MediaViewer | null,
  options: MediaAccessOptions = {}
): MediaAccessDecision {
  if (media.postId) {
    if (
      media.isPrivateCommunityPost &&
      (!viewer || !options.isCommunityMember)
    ) {
      return { allowed: false, status: 404 };
    }
    return { allowed: true };
  }

  if (media.commentId) {
    return viewer ? { allowed: true } : { allowed: false, status: 401 };
  }

  if (media.messageConversationId) {
    // Owner is always a member; guests and non-members learn nothing. Return
    // 404 (not 401) for guests too, so an unauthenticated caller cannot use
    // the status code to confirm that a message-media id exists.
    if (!viewer || !options.isConversationMember) {
      return { allowed: false, status: 404 };
    }
    return { allowed: true };
  }

  if (!viewer) {
    return { allowed: false, status: 401 };
  }

  // Ownerless unlinked rows are cleanup candidates; nothing sensible to serve.
  if (!media.userId || media.userId !== viewer.id) {
    return { allowed: false, status: 404 };
  }

  return { allowed: true };
}
