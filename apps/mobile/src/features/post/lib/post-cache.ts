import type { FeedPost } from "@/features/feed/lib/feed-types";

import type { PostDetail } from "./post-api";

export function postDetailKey(
  postId: string,
  viewerId: string | undefined,
  apiBase: string
): string {
  return JSON.stringify([apiBase, viewerId ?? null, postId]);
}

// Details are account-scoped and revalidated on every open. A feed preview
// paints immediately while the complete ancestor chain loads in the background.
export class PostDetailCache {
  private entries = new Map<string, PostDetail>();
  private inflight = new Map<string, Promise<PostDetail>>();

  read(key: string): PostDetail | undefined {
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  private write(key: string, detail: PostDetail): void {
    this.entries.delete(key);
    this.entries.set(key, detail);
    if (this.entries.size > 32) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
  }

  seed(key: string, post: FeedPost): void {
    if (!this.entries.has(key)) {
      this.write(key, { ancestors: [], post });
    }
  }

  load(key: string, loader: () => Promise<PostDetail>): Promise<PostDetail> {
    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }
    const request = (async () => {
      // Publish the promise before even a synchronously throwing loader runs.
      await Promise.resolve();
      try {
        const detail = await loader();
        this.write(key, detail);
        this.inflight.delete(key);
        return detail;
      } catch (error) {
        this.inflight.delete(key);
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          (error.status === 404 || error.status === 401 || error.status === 403)
        ) {
          this.entries.delete(key);
        }
        throw error;
      }
    })();
    this.inflight.set(key, request);
    return request;
  }
}

export const postDetailCache = new PostDetailCache();
