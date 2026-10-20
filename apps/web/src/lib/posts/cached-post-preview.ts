import type { PostData } from "@asm/db";
import { externalPostSchema } from "@asm/protocols/discovery";
import type { PostPreviewSource } from "@asm/ui/lib/post-preview-layout";

import { normalizePostData } from "./post-normalize";
import { externalPostView } from "./presentation";

const previews = new WeakMap<object, PostPreviewSource>();

export function cachedPostPreview(
  data: unknown,
  postId: string
): PostPreviewSource | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = cachedPostPreview(item, postId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  const record = data as Record<string, unknown>;
  if (record.id === postId && record.source === "bluesky") {
    const existing = previews.get(record);
    if (existing) {
      return existing;
    }
    const parsed = externalPostSchema.safeParse(record);
    if (parsed.success) {
      const preview = externalPostView(parsed.data);
      previews.set(record, preview);
      return preview;
    }
  }
  if (
    typeof record.id === "string" &&
    (record.id === postId ||
      (postId.length >= 8 && record.id.startsWith(postId))) &&
    typeof record.content === "string" &&
    Array.isArray(record.attachments)
  ) {
    const existing = previews.get(record);
    if (existing) {
      return existing;
    }
    const preview = normalizePostData(record as unknown as PostData);
    previews.set(record, preview);
    return preview;
  }
  for (const key of ["pages", "items", "posts", "post", "data", "parentPost"]) {
    const found = cachedPostPreview(record[key], postId);
    if (found) {
      return found;
    }
  }
  return undefined;
}
