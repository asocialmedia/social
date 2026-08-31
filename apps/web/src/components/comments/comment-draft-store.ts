"use client";

export interface CommentDraft {
  content: string;
  parentId?: string;
  replyingTo?: {
    commentId?: string;
    content?: string;
    username: string;
  } | null;
}

const DRAFT_PREFIX = "eddie-draft:";

export function getCommentDraftKey(postId: string, parentId?: string): string {
  return parentId
    ? `${DRAFT_PREFIX}${postId}:${parentId}`
    : `${DRAFT_PREFIX}${postId}`;
}

export function saveCommentDraft(postId: string, draft: CommentDraft): void {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }
  try {
    const key = getCommentDraftKey(postId, draft.parentId);
    if (!draft.content.trim() && !draft.replyingTo) {
      sessionStorage.removeItem(key);
      if (!draft.parentId) {
        sessionStorage.removeItem(getCommentDraftKey(postId));
      }
      return;
    }
    sessionStorage.setItem(key, JSON.stringify(draft));
    // Also mirror to top-level key so navigating to the post page can find it
    sessionStorage.setItem(getCommentDraftKey(postId), JSON.stringify(draft));
  } catch {
    // Ignore storage quota or access errors
  }
}

export function getCommentDraft(
  postId: string,
  parentId?: string
): CommentDraft | null {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return null;
  }
  try {
    const key = getCommentDraftKey(postId, parentId);
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<CommentDraft>;
    if (typeof parsed?.content === "string") {
      return {
        content: parsed.content,
        parentId: parsed.parentId,
        replyingTo: parsed.replyingTo,
      };
    }
  } catch {
    // Corrupt draft or storage error
  }
  return null;
}

export function clearCommentDraft(postId: string, parentId?: string): void {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }
  try {
    sessionStorage.removeItem(getCommentDraftKey(postId, parentId));
    sessionStorage.removeItem(getCommentDraftKey(postId));
  } catch {
    // Ignore errors
  }
}
