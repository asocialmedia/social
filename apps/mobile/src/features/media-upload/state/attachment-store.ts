// oxlint-disable sort-keys -- Action order groups lifecycle operations rather than sorting them alphabetically.
import { MAX_POST_ATTACHMENTS } from "@asm/media";
// Draft attachments for every native composer, ported from web's
// components/posts/editor/attachment-store.ts. Each composer owns a scope
// ("post", "eddie:<postId>:<parentId>") so the post composer and the eddie
// bars never share tiles.
//
// Behaviour carried over from web:
// - posts attach before READY (waitForProcessing:false): once finalized the
//   tile shows "Processing in background" and a watcher follows the status;
//   eddies wait for READY before they can be sent
// - cancel/remove aborts the transfer and discards the server draft
// - retry resumes at the failed step (re-finalize or keep polling) and only
//   re-sends bytes when the bytes never landed
// - alt text saves straight to the media (PATCH /alt), not the post payload
// Native additions: at most two uploads run at once app-wide (the server's
// per-IP upload budget is shared), and every transition is logged.
import { create } from "zustand";
import type { StateStorage } from "zustand/middleware";

import { toast } from "@/components/feedback/toast";
import { logWarn } from "@/lib/lifecycle/telemetry";
import { getApiBaseUrl } from "@/lib/network/api-env";

import { isAbortError, withRetry } from "../lib/retry";
import { discardDraftMedia, saveAltText } from "../lib/upload-api";
import type { UploadPurpose } from "../lib/upload-api";
import {
  finishFromFinalize,
  UploadError,
  uploadMedia,
  watchMediaStatus,
} from "../lib/upload-client";
import type { FailedStep } from "../lib/upload-client";
import { canAddMedia, familyFromMime } from "../lib/upload-policy";
import type { GateVerdict, MediaFamily } from "../lib/upload-policy";
import type { UploadStage } from "../lib/upload-status";
import {
  isStorableStatus,
  loadStoredDrafts,
  saveStoredDrafts,
} from "./attachment-persist";
import type { StoredAttachment } from "./attachment-persist";

export interface PickedMedia {
  durationMs?: number | null;
  height?: number;
  mimeType: string;
  name: string;
  size: number;
  uri: string;
  width?: number;
}

// One status per attachment (audit S0-2): uploading (bytes/finalize in
// flight), processing (finalized, serves while the server pipeline runs),
// detached (the watch deadline expired, retry re-watches like web's resuming
// marker), ready, error (retry resumes from retryFrom).
export type AttachmentStatus =
  | "detached"
  | "error"
  | "processing"
  | "ready"
  | "uploading";

export interface DraftAttachment {
  audioOverlayId?: string;
  altText: string;
  bytesPercent: number;
  durationMs: number | null;
  error: string | null;
  // Display-only pipeline phase for the last failure ("Failed at scan").
  failedStage: UploadStage | null;
  family: MediaFamily;
  // Set from add() options: a gust video must reopen in the gust editor.
  gust: boolean;
  height?: number;
  isGif: boolean;
  localId: string;
  mediaId: string | null;
  mimeType: string;
  name: string;
  purpose: UploadPurpose;
  // Step retry() resumes from (set for error + detached).
  retryFrom: FailedStep | null;
  size: number;
  stage: UploadStage;
  // Single status union (audit S0-2): the tile, the publish gate and retry
  // all read this field. `stage` stays as the display-only pipeline phase
  // and `error` carries the row copy for error + detached.
  status: AttachmentStatus;
  uri: string;
  waitForProcessing: boolean;
  width?: number;
}

interface AttachmentState {
  scopes: Record<string, DraftAttachment[]>;
}

const useAttachmentState = create<AttachmentState>(() => ({ scopes: {} }));

const controllers = new Map<string, AbortController>();
const EMPTY: DraftAttachment[] = [];

// App-wide upload concurrency: two transfers at a time, FIFO.
const MAX_CONCURRENT = 2;
let running = 0;
const waiting: (() => void)[] = [];

async function withUploadSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    // oxlint-disable-next-line promise/avoid-new -- parking the caller until a slot frees is the semaphore itself
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  }
  running += 1;
  try {
    return await task();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

function scopeOf(localId: string): string | null {
  const { scopes } = useAttachmentState.getState();
  for (const [scope, items] of Object.entries(scopes)) {
    if (items.some((item) => item.localId === localId)) {
      return scope;
    }
  }
  return null;
}

// Web's watchMediaStatus DETACHED copy (attachment-store.ts
// applyWatchOutcome): the pipeline is still running server-side.
const STILL_PROCESSING_COPY = "Still processing - check back in a moment";

function find(localId: string): DraftAttachment | null {
  const scope = scopeOf(localId);
  if (!scope) {
    return null;
  }
  return (
    useAttachmentState
      .getState()
      .scopes[scope]?.find((item) => item.localId === localId) ?? null
  );
}

function patch(localId: string, changes: Partial<DraftAttachment>): void {
  useAttachmentState.setState((state) => {
    const scopes = { ...state.scopes };
    for (const [scope, items] of Object.entries(scopes)) {
      if (items.some((item) => item.localId === localId)) {
        scopes[scope] = items.map((item) =>
          item.localId === localId ? { ...item, ...changes } : item
        );
      }
    }
    return { scopes };
  });
}

function fail(localId: string, error: unknown): void {
  const current = find(localId);
  if (!current) {
    return;
  }
  const upload = error instanceof UploadError ? error : null;
  if (upload?.rejected) {
    // Web's REJECTED path: the server refused the media, so the tile goes
    // away with the "Attachment Removed" toast instead of a retry row.
    attachmentActions.remove(localId);
    toast({
      description: upload.userMessage,
      title: "Attachment Removed",
      variant: "destructive",
    });
    return;
  }
  patch(localId, {
    error: upload?.userMessage ?? "Upload failed",
    failedStage:
      current.status === "error" ? current.failedStage : current.stage,
    mediaId: upload?.mediaId ?? current.mediaId,
    retryFrom: upload?.step ?? "upload",
    stage: "error",
    status: "error",
  });
}

// Background watcher for attachments published before READY.
function watchInBackground(localId: string, mediaId: string): void {
  const controller = new AbortController();
  controllers.set(localId, controller);
  void (async () => {
    try {
      const status = await watchMediaStatus(mediaId, {
        onStage: (stage) => patch(localId, { stage }),
        signal: controller.signal,
      });
      if (status === "READY") {
        patch(localId, { status: "ready", stage: "ready" });
      }
      // DETACHED from a background watch keeps the web "Still processing"
      // copy: a retry re-attaches the watcher.
      if (status === "DETACHED") {
        patch(localId, {
          error: STILL_PROCESSING_COPY,
          retryFrom: "processing",
          status: "detached",
        });
      }
    } catch (error) {
      if (!isAbortError(error)) {
        fail(localId, error);
      }
    }
  })();
}

async function run(
  localId: string,
  step: "full" | "finalize" | "watch"
): Promise<void> {
  const item = find(localId);
  if (!item) {
    return;
  }
  controllers.get(localId)?.abort();
  const controller = new AbortController();
  controllers.set(localId, controller);
  patch(localId, {
    error: null,
    failedStage: null,
    retryFrom: null,
    stage: step === "full" ? "uploading" : (item.failedStage ?? "queued"),
    status: "uploading",
  });
  const callbacks = {
    onBytes: (bytesPercent: number) => patch(localId, { bytesPercent }),
    onMediaId: (mediaId: string) => patch(localId, { mediaId }),
    onStage: (stage: UploadStage) => patch(localId, { stage }),
    signal: controller.signal,
  };
  try {
    await withUploadSlot(async () => {
      if (controller.signal.aborted) {
        return;
      }
      if (step === "watch" && item.mediaId) {
        const status = await watchMediaStatus(item.mediaId, callbacks);
        if (status === "READY") {
          patch(localId, { status: "ready", stage: "ready" });
          return;
        }
        // The watch deadline expired: web keeps the "Still processing" copy
        // and retry re-attaches the watcher.
        patch(localId, {
          error: STILL_PROCESSING_COPY,
          retryFrom: "processing",
          status: "detached",
        });
        return;
      }
      const outcome =
        step === "finalize" && item.mediaId
          ? await finishFromFinalize(item.mediaId, item.family, {
              ...callbacks,
              waitForProcessing: item.waitForProcessing,
            })
          : await uploadMedia(
              {
                height: item.height,
                mimeType: item.mimeType,
                name: item.name,
                size: item.size,
                uri: item.uri,
                width: item.width,
              },
              {
                ...callbacks,
                audioOverlayId: item.audioOverlayId,
                purpose: item.purpose,
                waitForProcessing: item.waitForProcessing,
              }
            );
      if (outcome.status === "READY") {
        patch(localId, {
          bytesPercent: 100,
          status: "ready",
          mediaId: outcome.mediaId,
          stage: "ready",
        });
        return;
      }
      if (outcome.status === "DETACHED" && item.waitForProcessing) {
        // Eddies wait for READY before they can send: keep web's "Still
        // processing" copy and let retry re-attach the watcher.
        patch(localId, {
          bytesPercent: 100,
          error: STILL_PROCESSING_COPY,
          mediaId: outcome.mediaId,
          retryFrom: "processing",
          status: "detached",
        });
        return;
      }
      patch(localId, {
        bytesPercent: 100,
        status: "processing",
        mediaId: outcome.mediaId,
      });
      if (!item.waitForProcessing) {
        watchInBackground(localId, outcome.mediaId);
      }
    });
  } catch (error) {
    if (!isAbortError(error)) {
      fail(localId, error);
    }
  }
}

function newLocalId(): string {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface AddResult {
  added: number;
  rejected: Exclude<GateVerdict, { ok: true }>["reason"] | "unsupported" | null;
}

export const attachmentActions = {
  // Adds picked files through web's media gate; returns why any were refused
  // so the composer can show web's toast.
  add(
    scope: string,
    picked: PickedMedia[],
    options: {
      audioOverlayId?: string;
      gust?: boolean;
      max: number;
      purpose: UploadPurpose;
      waitForProcessing: boolean;
    }
  ): AddResult {
    let rejected: AddResult["rejected"] = null;
    const accepted: DraftAttachment[] = [];
    for (const file of picked) {
      let family: MediaFamily;
      try {
        family = familyFromMime(file.mimeType);
      } catch {
        rejected = "unsupported";
        continue;
      }
      const isGif = file.mimeType.toLowerCase() === "image/gif";
      const existing = [
        ...(useAttachmentState.getState().scopes[scope] ?? EMPTY),
        ...accepted,
      ];
      const verdict = canAddMedia(existing, { family, isGif }, options);
      if (!verdict.ok) {
        rejected ??= verdict.reason;
        continue;
      }
      accepted.push({
        altText: "",
        audioOverlayId: options.audioOverlayId,
        bytesPercent: 0,
        durationMs: file.durationMs ?? null,
        error: null,
        failedStage: null,
        family,
        gust: options.gust ?? false,
        height: file.height,
        isGif,
        localId: newLocalId(),
        mediaId: null,
        mimeType: file.mimeType,
        name: file.name,
        purpose: options.purpose,
        retryFrom: null,
        size: file.size,
        stage: "uploading",
        status: "uploading",
        uri: file.uri,
        waitForProcessing: options.waitForProcessing,
        width: file.width,
      });
    }
    if (accepted.length > 0) {
      useAttachmentState.setState((state) => ({
        scopes: {
          ...state.scopes,
          [scope]: [...(state.scopes[scope] ?? EMPTY), ...accepted],
        },
      }));
      for (const item of accepted) {
        void run(item.localId, "full");
      }
    }
    return { added: accepted.length, rejected };
  },

  replace(localId: string, picked: PickedMedia): void {
    const { scopes } = useAttachmentState.getState();
    const scope = Object.keys(scopes).find((key) =>
      scopes[key].some((item) => item.localId === localId)
    );
    if (!scope) {
      return;
    }
    const original = scopes[scope];
    const index = original.findIndex((item) => item.localId === localId);
    const previous = original[index];
    attachmentActions.remove(localId);
    attachmentActions.add(scope, [picked], {
      audioOverlayId: previous.audioOverlayId,
      gust: previous.gust,
      max: MAX_POST_ATTACHMENTS,
      purpose: previous.purpose,
      waitForProcessing: previous.waitForProcessing,
    });
    const current = useAttachmentState.getState().scopes[scope];
    const replacement = current.at(-1);
    if (!replacement) {
      return;
    }
    const ordered = current.filter(
      (item) => item.localId !== replacement.localId
    );
    ordered.splice(index, 0, { ...replacement, altText: previous.altText });
    useAttachmentState.setState((state) => ({
      scopes: { ...state.scopes, [scope]: ordered },
    }));
  },

  // After a successful publish the media is attached (no discard); on a
  // cancelled composer every draft is discarded.
  clear(scope: string, options: { discard: boolean }): void {
    const items = useAttachmentState.getState().scopes[scope] ?? EMPTY;
    for (const item of items) {
      controllers.get(item.localId)?.abort();
      controllers.delete(item.localId);
      if (options.discard && item.mediaId) {
        void discardDraftMedia(item.mediaId);
      }
    }
    useAttachmentState.setState((state) => ({
      scopes: Object.fromEntries(
        Object.entries(state.scopes).filter(([key]) => key !== scope)
      ),
    }));
  },

  move(scope: string, from: number, to: number): void {
    useAttachmentState.setState((state) => {
      const items = [...(state.scopes[scope] ?? EMPTY)];
      const [moved] = items.splice(from, 1);
      if (!moved) {
        return state;
      }
      items.splice(Math.max(0, Math.min(items.length, to)), 0, moved);
      return { scopes: { ...state.scopes, [scope]: items } };
    });
  },

  // Cancel/remove: abort the transfer and discard the unattached draft.
  remove(localId: string): void {
    const item = find(localId);
    controllers.get(localId)?.abort();
    controllers.delete(localId);
    useAttachmentState.setState((state) => {
      const scopes = { ...state.scopes };
      for (const [scope, items] of Object.entries(scopes)) {
        scopes[scope] = items.filter((entry) => entry.localId !== localId);
      }
      return { scopes };
    });
    if (item?.mediaId) {
      void discardDraftMedia(item.mediaId);
    }
  },

  retry(localId: string): void {
    const item = find(localId);
    if (!item) {
      return;
    }
    if (item.status !== "error" && item.status !== "detached") {
      return;
    }
    if (item.mediaId && item.retryFrom === "processing") {
      void run(localId, "watch");
    } else if (item.mediaId && item.retryFrom === "finalize") {
      void run(localId, "finalize");
    } else {
      void run(localId, "full");
    }
  },

  async setAltText(localId: string, altText: string): Promise<boolean> {
    const item = find(localId);
    if (!item) {
      return false;
    }
    patch(localId, { altText });
    if (!item.mediaId) {
      return true;
    }
    const { mediaId } = item;
    try {
      await withRetry(() => saveAltText(mediaId, altText), { attempts: 3 });
      return true;
    } catch (error) {
      logWarn("upload.alt_save_failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      return false;
    }
  },
};

// Web's publish gate lives in lib/readiness.ts (pure, unit-tested).
export { scopeReadiness } from "../lib/readiness";

export function useScopeAttachments(scope: string): DraftAttachment[] {
  return useAttachmentState((state) => state.scopes[scope] ?? EMPTY);
}

export function getScopeAttachments(scope: string): DraftAttachment[] {
  return useAttachmentState.getState().scopes[scope] ?? EMPTY;
}

async function secureDraftStorage(): Promise<StateStorage> {
  // Dynamic import: expo-secure-store cannot load under bun, and only the
  // app runtime ever hydrates drafts.
  const SecureStore = await import("expo-secure-store");
  return {
    getItem: async (key) => {
      try {
        return await SecureStore.getItemAsync(key);
      } catch {
        return null;
      }
    },
    removeItem: async (key) => {
      try {
        await SecureStore.deleteItemAsync(key);
      } catch {
        // Unavailable storage must not break the composer.
      }
    },
    setItem: async (key, value) => {
      try {
        await SecureStore.setItemAsync(key, value);
      } catch {
        // Drafts that do not fit stay in memory for this session.
      }
    },
  };
}

let persistenceStarted = false;
let lastPersistedJson = "";

// Persists only settled server rows (progress ticks do not change the
// payload, so the write is skipped) and clears with the scope.
export function startAttachmentDraftPersistence(storage: StateStorage): void {
  if (persistenceStarted) {
    return;
  }
  persistenceStarted = true;
  useAttachmentState.subscribe((state) => {
    const storable: Record<string, StoredAttachment[]> = {};
    for (const [scope, items] of Object.entries(state.scopes)) {
      const kept = items
        .filter(
          (item) => item.mediaId !== null && isStorableStatus(item.status)
        )
        .map((item) => ({
          altText: item.altText === "" ? undefined : item.altText,
          audioOverlayId: item.audioOverlayId,
          family: item.family,
          gust: item.gust === true ? true : undefined,
          mediaId: item.mediaId as string,
          mimeType: item.mimeType,
          name: item.name,
          processing: item.status === "processing" ? true : undefined,
          purpose: item.purpose,
          waitForProcessing: item.waitForProcessing === true ? true : undefined,
        }));
      if (kept.length > 0) {
        storable[scope] = kept;
      }
    }
    const json = JSON.stringify(storable);
    if (json === lastPersistedJson) {
      return;
    }
    lastPersistedJson = json;
    void saveStoredDrafts(storage, storable);
  });
}

let hydratePromise: Promise<{ gustVideo: boolean }> | null = null;

// Restores settled server rows (web's hydrate): processing rows re-attach a
// status watcher, and a restored gust video reports back so the composer
// reopens in the gust editor. Safe to call on every composer open.
export function hydrateAttachmentDrafts(
  storage?: StateStorage
): Promise<{ gustVideo: boolean }> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      const store = storage ?? (await secureDraftStorage());
      const decoded = await loadStoredDrafts(store);
      const apiBase = getApiBaseUrl().replace(/\/+$/, "");
      const scopes: Record<string, DraftAttachment[]> = {};
      let gustVideo = false;
      for (const [scope, items] of Object.entries(decoded)) {
        const restored: DraftAttachment[] = [];
        for (const item of items) {
          const processing = item.processing === true;
          if (item.gust === true) {
            gustVideo = true;
          }
          restored.push({
            altText: item.altText ?? "",
            audioOverlayId: item.audioOverlayId,
            bytesPercent: 100,
            durationMs: null,
            error: null,
            failedStage: null,
            family: item.family,
            gust: item.gust ?? false,
            height: undefined,
            isGif: item.mimeType.toLowerCase() === "image/gif",
            localId: newLocalId(),
            mediaId: item.mediaId,
            mimeType: item.mimeType,
            name: item.name,
            purpose: item.purpose,
            retryFrom: null,
            size: 0,
            stage: processing ? "processing" : "ready",
            status: processing ? "processing" : "ready",
            uri: `${apiBase}/api/media/${item.mediaId}`,
            waitForProcessing: item.waitForProcessing ?? false,
            width: undefined,
          });
        }
        if (restored.length > 0) {
          scopes[scope] = restored;
        }
      }
      if (Object.keys(scopes).length > 0) {
        // Never clobber attachments added while storage was loading.
        const current = useAttachmentState.getState().scopes;
        const merged: Record<string, DraftAttachment[]> = { ...current };
        const added: DraftAttachment[] = [];
        for (const [scope, items] of Object.entries(scopes)) {
          if ((merged[scope] ?? []).length === 0) {
            merged[scope] = items;
            added.push(...items);
          }
        }
        if (added.length > 0) {
          useAttachmentState.setState({ scopes: merged });
          for (const attachment of added) {
            if (
              attachment.status === "processing" &&
              attachment.mediaId !== null
            ) {
              watchInBackground(attachment.localId, attachment.mediaId);
            }
          }
        }
      }
      startAttachmentDraftPersistence(store);
      return { gustVideo };
    })();
  }
  return hydratePromise;
}
