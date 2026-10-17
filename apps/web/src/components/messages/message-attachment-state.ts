import {
  MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES,
  MAX_MESSAGE_ATTACHMENTS,
  maxMessageAttachmentBytes,
  messageAttachmentKind,
  messageAttachmentMimeType,
} from "@asm/media";

import type { UploadStage } from "@/lib/media/media-upload-client";
import type { MediaAttachmentRef } from "@/lib/messages/crypto";

// Pure staging logic for the message composer, split out from the hook so the
// filtering, capacity, and grouping rules can be unit-tested without a DOM.
// `draft.file` is a browser File (non-serializable); everything else is plain
// data.

export type MessageAttachmentKind = "file" | "gif" | "image" | "video";
export type MessageAttachmentStatus = "error" | "ready" | "uploading";

export interface MessageAttachmentDraft {
  error?: string;
  file: File;
  bytes: number;
  durationSec: number | null;
  filename: string;
  height: number | null;
  id: string;
  kind: MessageAttachmentKind;
  mediaId?: string;
  mimeType: string;
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
  attachments: MediaAttachmentRef[];
}

// Messages carry images and GIFs only. SVG is excluded because it is blocked
// by the upload policy (it can execute script when rendered inline).
export function normalizedMessageFile(file: File): File | null {
  const mimeType = messageAttachmentMimeType(file.type, file.name);
  if (!messageAttachmentKind(mimeType)) {
    return null;
  }
  if (mimeType === file.type) {
    return file;
  }
  return new File([file], file.name, {
    lastModified: file.lastModified,
    type: mimeType,
  });
}

export function isAllowedMessageAttachment(file: File): boolean {
  const mimeType = messageAttachmentMimeType(file.type, file.name);
  return messageAttachmentKind(mimeType) !== null;
}

export function kindForFile(file: File): MessageAttachmentKind {
  const mimeType = messageAttachmentMimeType(file.type, file.name);
  const kind = messageAttachmentKind(mimeType);
  if (!kind) {
    throw new Error("Unsupported message attachment");
  }
  return kind;
}

export interface SelectionResult {
  accepted: File[];
  // Supported files that exceeded the remaining attachment count.
  overflow: number;
  // Files larger than their type cap or the aggregate message budget.
  tooLarge: number;
  // Files rejected outright (unsupported or active content types).
  rejected: number;
}

// Splits an incoming selection into accepted files, overflow beyond the
// per-album cap, and rejected non-images. The cap applies to the images that
// passed the filter, not the raw selection.
export function selectAcceptedFiles(
  existingCount: number,
  incoming: File[],
  existingBytes = 0
): SelectionResult {
  const allowed = incoming.flatMap((file) => {
    const normalized = normalizedMessageFile(file);
    return normalized ? [normalized] : [];
  });
  const capacity = Math.max(0, MAX_MESSAGE_ATTACHMENTS - existingCount);
  let totalBytes = existingBytes;
  let tooLarge = 0;
  const withinLimits: File[] = [];
  for (const file of allowed) {
    const maxBytes = maxMessageAttachmentBytes(file.type);
    if (
      file.size <= 0 ||
      file.size > maxBytes ||
      totalBytes + file.size > MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES
    ) {
      tooLarge += 1;
      continue;
    }
    totalBytes += file.size;
    withinLimits.push(file);
  }
  const accepted = withinLimits.slice(0, capacity);
  return {
    accepted,
    overflow: withinLimits.length - accepted.length,
    rejected: incoming.length - allowed.length,
    tooLarge,
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

// A staged upload's server row. `owned` is true only when this draft uploaded
// fresh bytes: a dedup hit may point at a row already backing a sent message, so
// it must never be discarded on removal.
export interface StagedMediaId {
  mediaId: string;
  owned: boolean;
}

// Whether any draft outside `removedIds` still references the media row.
// Prevents removing one tile from deleting a row another tile (or an earlier
// send) still depends on.
export function isMediaReferenced(
  entries: Map<string, StagedMediaId>,
  mediaId: string,
  removedIds: Set<string>
): boolean {
  for (const [draftId, entry] of entries) {
    if (!removedIds.has(draftId) && entry.mediaId === mediaId) {
      return true;
    }
  }
  return false;
}

// Detaches a group's media rows from staging so the unmount sweep can no longer
// discard them, and returns the detached entries so a failed send can restore
// them.
//
// This has to happen synchronously BEFORE the send is awaited. Once the server
// has been handed a media id it can no longer tell a row backing a sent message
// from an abandoned draft - the ids live inside the encrypted payload, so the
// media row is never linked to a message. A discard in that window clears the
// row's conversation link, which leaves the sender able to read it (unlinked
// rows are owner-readable) while the peer 404s on every fetch, permanently.
// "Discardable" therefore has to mean "the server was never asked to reference
// this row", and only a claim made before the send can guarantee that.
export function claimStagedMedia(
  entries: Map<string, StagedMediaId>,
  ids: string[]
): Map<string, StagedMediaId> {
  const claimed = new Map<string, StagedMediaId>();
  for (const id of ids) {
    const entry = entries.get(id);
    if (entry) {
      claimed.set(id, entry);
    }
    entries.delete(id);
  }
  return claimed;
}

// Puts a claimed group back under staging after a send that never landed, so
// the rows stay reclaimable when the sender clears them or leaves the thread.
// Entries claimed since (a newer draft reusing the id) are left alone.
export function restoreStagedMedia(
  entries: Map<string, StagedMediaId>,
  claimed: Map<string, StagedMediaId>
): void {
  for (const [id, entry] of claimed) {
    if (!entries.has(id)) {
      entries.set(id, entry);
    }
  }
}

// One typed payload keeps mixed attachments together in their selected order.
export function groupReadyAttachments(
  attachments: MessageAttachmentDraft[]
): GroupedMessageAttachments[] {
  const ready: MessageAttachmentDraft[] = [];
  for (const attachment of attachments) {
    if (attachment.status !== "ready" || !attachment.mediaUrl) {
      continue;
    }
    ready.push(attachment);
  }
  if (ready.length === 0) {
    return [];
  }
  return [
    {
      attachmentIds: ready.map((attachment) => attachment.id),
      attachments: ready.map((attachment) => {
        if (attachment.kind === "file") {
          return {
            bytes: attachment.bytes,
            filename: attachment.filename,
            kind: "file" as const,
            mimeType: attachment.mimeType,
            url: attachment.mediaUrl as string,
          };
        }
        if (attachment.kind === "video") {
          return {
            durationSec: attachment.durationSec ?? undefined,
            height: attachment.height ?? undefined,
            kind: "video" as const,
            url: attachment.mediaUrl as string,
            width: attachment.width ?? undefined,
          };
        }
        return {
          height: attachment.height ?? undefined,
          kind: attachment.kind,
          url: attachment.mediaUrl as string,
          width: attachment.width ?? undefined,
        };
      }),
    },
  ];
}
