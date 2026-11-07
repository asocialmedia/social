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
    url: media.id.startsWith("https://")
      ? media.id
      : `${apiBase.replace(/\/+$/, "")}/api/media/${encodeURIComponent(media.id)}`,
  };
}

// Port of web media-viewer's 429 branch: the server rate-limits media
// downloads, and expo's File.downloadFileAsync rejects an `UnableToDownload`
// error whose message carries the HTTP status. Classifying it here keeps the
// toast copy next to the download path.
export class DownloadRateLimitedError extends Error {
  constructor() {
    super("Too many downloads");
    this.name = "DownloadRateLimitedError";
  }
}

// True when a download failure is the server's 429 backpressure (or an
// already-classified instance), so the caller can ask the viewer to slow
// down instead of showing the generic failure copy.
export function isRateLimitedDownload(error: unknown): boolean {
  if (error instanceof DownloadRateLimitedError) {
    return true;
  }
  if (error instanceof Error) {
    return /\b429\b/.test(error.message);
  }
  return false;
}
