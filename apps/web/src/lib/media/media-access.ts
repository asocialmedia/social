// Access decisions for serving stored media objects. Media rows come in three
// flavors and each has a different audience:
//
//  post-linked   (postId set)      -> public; posts are publicly viewable in
//                                     feeds, so their attachments are too.
//  comment-linked(commentId set)   -> signed-in users only; comment threads
//                                     are only readable when authenticated.
//  unlinked      (message E2EE     -> owner only. Message attachments are never
//                 attachments,       linked to a post/comment by design, and
//                 abandoned drafts)  orphaned draft uploads belong to their
//                                   uploader until attached.
//
// The decision is pure so it can be unit-tested without a database.

export interface MediaOwnership {
  postId: string | null;
  commentId: string | null;
  userId: string | null;
}

export interface MediaViewer {
  id: string;
}

export type MediaAccessDecision =
  | { allowed: true }
  | { allowed: false; status: 401 | 403 | 404 };

export function decideMediaAccess(
  media: MediaOwnership,
  viewer: MediaViewer | null
): MediaAccessDecision {
  if (media.postId) {
    return { allowed: true };
  }

  if (media.commentId) {
    return viewer ? { allowed: true } : { allowed: false, status: 401 };
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
