import { beforeEach, describe, expect, it } from "bun:test";

import {
  clearCommentDraft,
  getCommentDraft,
  getCommentDraftKey,
  saveCommentDraft,
} from "./comment-draft-store";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

Object.assign(globalThis, {
  document: { documentElement: { dataset: {} } },
  sessionStorage: new MemoryStorage(),
  window: globalThis,
});

describe("comment-draft-store", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("generates distinct keys for top-level and reply drafts", () => {
    expect(getCommentDraftKey("post-1")).toBe("eddie-draft:post-1");
    expect(getCommentDraftKey("post-1", "comment-2")).toBe(
      "eddie-draft:post-1:comment-2"
    );
  });

  it("saves and retrieves top-level comment drafts", () => {
    saveCommentDraft("post-1", { content: "Hello world" });
    const draft = getCommentDraft("post-1");
    expect(draft).toEqual({
      content: "Hello world",
      parentId: undefined,
      replyingTo: undefined,
    });
  });

  it("saves and retrieves reply drafts with metadata", () => {
    saveCommentDraft("post-1", {
      content: "Replying to you",
      parentId: "comment-123",
      replyingTo: {
        commentId: "comment-123",
        content: "Original eddie",
        username: "testuser",
      },
    });

    const draft = getCommentDraft("post-1", "comment-123");
    expect(draft).toEqual({
      content: "Replying to you",
      parentId: "comment-123",
      replyingTo: {
        commentId: "comment-123",
        content: "Original eddie",
        username: "testuser",
      },
    });
  });

  it("removes empty drafts", () => {
    saveCommentDraft("post-1", { content: "Will be removed" });
    expect(getCommentDraft("post-1")).not.toBeNull();

    saveCommentDraft("post-1", { content: "   " });
    expect(getCommentDraft("post-1")).toBeNull();
  });

  it("does not return top-level draft when querying an unrelated reply parentId", () => {
    saveCommentDraft("post-1", { content: "Top level draft" });
    expect(getCommentDraft("post-1", "unrelated-comment-id")).toBeNull();
  });

  it("clears drafts cleanly on submit", () => {
    saveCommentDraft("post-1", { content: "To be cleared" });
    clearCommentDraft("post-1");
    expect(getCommentDraft("post-1")).toBeNull();
  });
});
