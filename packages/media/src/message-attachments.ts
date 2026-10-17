import { DEFAULT_LIMITS, maxBytesForType } from "./limits";

export type MessageAttachmentKind = "file" | "gif" | "image" | "video";
export type MessageAttachmentMediaType =
  | "AUDIO"
  | "DOCUMENT"
  | "IMAGE"
  | "VIDEO";

const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4a: "audio/mp4",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

export function messageAttachmentMimeType(
  mimeType: string | null | undefined,
  fileName: string
): string {
  const normalized = mimeType?.split(";")[0]?.trim().toLowerCase();
  if (normalized && normalized !== "application/octet-stream") {
    return normalized;
  }
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

export function messageAttachmentMediaType(
  mimeType: string
): MessageAttachmentMediaType | null {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith("image/") && normalized !== "image/svg+xml") {
    return "IMAGE";
  }
  if (normalized.startsWith("video/")) {
    return "VIDEO";
  }
  if (normalized.startsWith("audio/")) {
    return "AUDIO";
  }
  return DOCUMENT_MIME_TYPES.has(normalized) ? "DOCUMENT" : null;
}

export function messageAttachmentKind(
  mimeType: string
): MessageAttachmentKind | null {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/gif") {
    return "gif";
  }
  if (normalized.startsWith("image/") && normalized !== "image/svg+xml") {
    return "image";
  }
  if (normalized.startsWith("video/")) {
    return "video";
  }
  return normalized.startsWith("audio/") || DOCUMENT_MIME_TYPES.has(normalized)
    ? "file"
    : null;
}

export function maxMessageAttachmentBytes(mimeType: string): number {
  const type = messageAttachmentMediaType(mimeType);
  return type ? maxBytesForType(DEFAULT_LIMITS, type) : 0;
}

export const MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES =
  DEFAULT_LIMITS.maxMessageAttachmentTotalBytes;

export function isMessageDocumentMime(mimeType: string): boolean {
  return DOCUMENT_MIME_TYPES.has(mimeType.toLowerCase());
}
