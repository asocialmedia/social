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
  mediaId?: string;
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
