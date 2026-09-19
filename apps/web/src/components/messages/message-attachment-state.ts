import { MAX_MESSAGE_ATTACHMENTS } from "@asm/media";

import type { UploadStage } from "@/lib/media/media-upload-client";
import type { MediaImageRef } from "@/lib/messages/crypto";

// Pure staging logic for the message composer, split out from the hook so the
// filtering, capacity, and grouping rules can be unit-tested without a DOM.
// `draft.file` is a browser File (non-serializable); everything else is plain
// data.

export type MessageAttachmentKind = "gif" | "image";
export type MessageAttachmentStatus = "error" | "ready" | "uploading";

export interface MessageAttachmentDraft {
  error?: string;
  file: File;
  height: number | null;
  id: string;
  kind: MessageAttachmentKind;
  mediaUrl?: string;
  objectUrl: string;
  progress: number;
  stage: UploadStage;
  status: MessageAttachmentStatus;
  width: number | null;
}

export interface GroupedMessageAttachments {
  // Draft ids backing this group, so the composer can clear exactly the groups
  // that were sent if a later group in the batch fails.
  attachmentIds: string[];
  images: MediaImageRef[];
  kind: MessageAttachmentKind;
}

// Messages carry images and GIFs only. SVG is excluded because it is blocked
// by the upload policy (it can execute script when rendered inline).
export function isAllowedMessageImage(file: File): boolean {
  return file.type.startsWith("image/") && file.type !== "image/svg+xml";
}

export function kindForFile(file: File): MessageAttachmentKind {
  return file.type === "image/gif" ? "gif" : "image";
}

export interface SelectionResult {
  accepted: File[];
  // Files that made it through the image filter but exceeded the cap.
  overflow: number;
  // Files rejected outright (non-images, SVG).
  rejected: number;
}

// Splits an incoming selection into accepted files, overflow beyond the
// per-album cap, and rejected non-images. The cap applies to the images that
// passed the filter, not the raw selection.
export function selectAcceptedFiles(
  existingCount: number,
  incoming: File[]
): SelectionResult {
  const allowed = incoming.filter(isAllowedMessageImage);
  const capacity = Math.max(0, MAX_MESSAGE_ATTACHMENTS - existingCount);
  const accepted = allowed.slice(0, capacity);
  return {
    accepted,
    overflow: allowed.length - accepted.length,
    rejected: incoming.length - allowed.length,
  };
}

export function isReadyToSend(attachments: MessageAttachmentDraft[]): boolean {
  return (
    attachments.length > 0 &&
    attachments.every((attachment) => attachment.status === "ready")
  );
}

export function hasUploading(attachments: MessageAttachmentDraft[]): boolean {
  return attachments.some((attachment) => attachment.status === "uploading");
}

// Groups ready attachments by media kind, preserving order. A mixed batch (some
// GIFs, some photos) becomes one album message per kind, because a single
// encrypted media payload carries one `kind` for all of its images.
export function groupReadyAttachments(
  attachments: MessageAttachmentDraft[]
): GroupedMessageAttachments[] {
  const groups = new Map<
    MessageAttachmentKind,
    { attachmentIds: string[]; images: MediaImageRef[] }
  >();
  for (const attachment of attachments) {
    if (attachment.status !== "ready" || !attachment.mediaUrl) {
      continue;
    }
    const group = groups.get(attachment.kind) ?? {
      attachmentIds: [],
      images: [],
    };
    group.images.push({
      height: attachment.height ?? undefined,
      url: attachment.mediaUrl,
      width: attachment.width ?? undefined,
    });
    group.attachmentIds.push(attachment.id);
    groups.set(attachment.kind, group);
  }
  return [...groups.entries()].map(([kind, group]) => ({
    attachmentIds: group.attachmentIds,
    images: group.images,
    kind,
  }));
}
