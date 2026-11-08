// Session persistence for composer attachment drafts, ported from web's
// components/posts/editor/attachment-store.ts sessionStorage layer
// (STORAGE_KEY asm-composer-attachments, STORAGE_VERSION 2).
//
// Only server rows are stored, never local files: a restored draft renders
// from the serving URL, exactly like web restores from
// `/api/media/:mediaId`. Restored rows that were still processing re-attach
// a status watcher on hydrate. The composer mode the draft was authored in
// rides along: a gust video must reopen in the gust editor, not as a fleet
// attachment.
//
// Storage is injected (SecureStore in the app, in-memory in tests) because
// the native module cannot load under bun.
import type { StateStorage } from "zustand/middleware";

import type { UploadPurpose } from "../lib/upload-api";
import type { MediaFamily } from "../lib/upload-policy";

export const ATTACHMENT_DRAFTS_KEY = "asm-composer-attachments";
export const ATTACHMENT_DRAFTS_VERSION = 2;

export interface StoredAttachment {
  altText?: string;
  audioOverlayId?: string;
  family: MediaFamily;
  gust?: boolean;
  mediaId: string;
  mimeType: string;
  name: string;
  processing?: boolean;
  purpose: UploadPurpose;
  waitForProcessing?: boolean;
}

export interface StoredAttachmentDrafts {
  scopes?: Record<string, StoredAttachment[]>;
  version?: number;
}

export function encodeScopesForStorage(
  scopes: Record<string, StoredAttachment[]>
): StoredAttachmentDrafts {
  return { scopes, version: ATTACHMENT_DRAFTS_VERSION };
}

export function isStorableStatus(status: string): boolean {
  return status === "processing" || status === "ready";
}

export function decodeStoredDrafts(
  payload: unknown
): Record<string, StoredAttachment[]> {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const { scopes, version } = payload as StoredAttachmentDrafts;
  if (version !== ATTACHMENT_DRAFTS_VERSION || !scopes) {
    return {};
  }
  const decoded: Record<string, StoredAttachment[]> = {};
  for (const [scope, items] of Object.entries(scopes)) {
    if (!Array.isArray(items)) {
      continue;
    }
    const kept = items.filter(
      (item): item is StoredAttachment =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof item.mediaId === "string" &&
        typeof item.mimeType === "string"
    );
    if (kept.length > 0) {
      decoded[scope] = kept;
    }
  }
  return decoded;
}

export async function loadStoredDrafts(
  storage: Pick<StateStorage, "getItem">
): Promise<Record<string, StoredAttachment[]>> {
  try {
    const raw = await storage.getItem(ATTACHMENT_DRAFTS_KEY);
    if (!raw) {
      return {};
    }
    return decodeStoredDrafts(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

export async function saveStoredDrafts(
  storage: Pick<StateStorage, "setItem">,
  scopes: Record<string, StoredAttachment[]>
): Promise<void> {
  try {
    await storage.setItem(
      ATTACHMENT_DRAFTS_KEY,
      JSON.stringify(encodeScopesForStorage(scopes))
    );
  } catch {
    // Unavailable storage must not break the composer.
  }
}

export async function clearStoredDrafts(
  storage: Pick<StateStorage, "removeItem">
): Promise<void> {
  try {
    await storage.removeItem(ATTACHMENT_DRAFTS_KEY);
  } catch {
    // Unavailable storage must not break the composer.
  }
}
