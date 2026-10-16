import type { PostPreviewSource } from "@asm/ui/lib/post-preview-layout";

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
  if (
    typeof record.id === "string" &&
    (record.id === postId ||
      (postId.length >= 8 && record.id.startsWith(postId))) &&
    typeof record.content === "string" &&
    Array.isArray(record.attachments)
  ) {
    return record as unknown as PostPreviewSource;
  }
  for (const key of ["pages", "posts", "post", "data", "parentPost"]) {
    const found = cachedPostPreview(record[key], postId);
    if (found) {
      return found;
    }
  }
  return undefined;
}
