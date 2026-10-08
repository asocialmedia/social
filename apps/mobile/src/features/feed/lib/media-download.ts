import type { FeedMedia } from "./feed-types";

// Save and share the original, preserving GIF animation and original video quality.
export function mediaDownloadDescriptor(apiBase: string, media: FeedMedia) {
  const extensions: Record<string, string> = {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  const extension =
    extensions[media.mimeType ?? ""] ??
    (media.type === "VIDEO" ? "mp4" : "jpg");
  return {
    fileName: `asocialmedia-${media.id.replaceAll(/[^a-zA-Z0-9_-]/g, "")}.${extension}`,
    mimeType:
      media.mimeType ?? (media.type === "VIDEO" ? "video/mp4" : "image/jpeg"),
    url: `${apiBase.replace(/\/+$/, "")}/api/media/${encodeURIComponent(media.id)}`,
  };
}
