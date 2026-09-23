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

import { logWarn } from "@/lib/telemetry";

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

export interface PickedMedia {
  durationMs?: number | null;
  height?: number;
  mimeType: string;
  name: string;
  size: number;
  uri: string;
  width?: number;
}

export interface DraftAttachment {
  altText: string;
  bytesPercent: number;
  durationMs: number | null;
  error: string | null;
  failedStage: UploadStage | null;
  failedStep: FailedStep | null;
  family: MediaFamily;
  height?: number;
  isGif: boolean;
  // Attached before READY: publishing is allowed while this is true.
  isProcessing: boolean;
  localId: string;
  mediaId: string | null;
  mimeType: string;
  name: string;
  purpose: UploadPurpose;
  size: number;
  stage: UploadStage;
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
  patch(localId, {
    error: upload?.userMessage ?? "Upload failed",
    failedStage:
      current.stage === "error" ? current.failedStage : current.stage,
    failedStep: upload?.step ?? "upload",
    isProcessing: false,
    mediaId: upload?.mediaId ?? current.mediaId,
    stage: "error",
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
        patch(localId, { isProcessing: false, stage: "ready" });
      }
      // DETACHED: keeps processing server-side; the tile stays publishable.
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
    failedStep: null,
    stage: step === "full" ? "uploading" : (item.failedStage ?? "queued"),
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
        patch(localId, {
          isProcessing: status !== "READY" && !item.waitForProcessing,
          stage: status === "READY" ? "ready" : "processing",
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
                purpose: item.purpose,
                waitForProcessing: item.waitForProcessing,
              }
            );
      if (outcome.status === "READY") {
        patch(localId, {
          bytesPercent: 100,
          isProcessing: false,
          mediaId: outcome.mediaId,
          stage: "ready",
        });
        return;
      }
      patch(localId, {
        bytesPercent: 100,
        isProcessing: true,
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
        bytesPercent: 0,
        durationMs: file.durationMs ?? null,
        error: null,
        failedStage: null,
        failedStep: null,
        family,
        height: file.height,
        isGif,
        isProcessing: false,
        localId: newLocalId(),
        mediaId: null,
        mimeType: file.mimeType,
        name: file.name,
        purpose: options.purpose,
        size: file.size,
        stage: "uploading",
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
    if (item.mediaId && item.failedStep === "processing") {
      void run(localId, "watch");
    } else if (item.mediaId && item.failedStep === "finalize") {
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

export function useScopeAttachments(scope: string): DraftAttachment[] {
  return useAttachmentState((state) => state.scopes[scope] ?? EMPTY);
}

export function getScopeAttachments(scope: string): DraftAttachment[] {
  return useAttachmentState.getState().scopes[scope] ?? EMPTY;
}

// Web's publish gate: nothing uploading, nothing errored. Processing tiles
// (attached before READY) do not block posts; eddies wait for READY.
export function scopeReadiness(items: readonly DraftAttachment[]): {
  hasError: boolean;
  isBusy: boolean;
  mediaIds: string[];
} {
  const hasError = items.some((item) => item.stage === "error");
  const isBusy = items.some((item) => {
    if (item.stage === "error") {
      return false;
    }
    if (item.waitForProcessing) {
      return item.stage !== "ready";
    }
    return !item.isProcessing && item.stage !== "ready";
  });
  return {
    hasError,
    isBusy,
    mediaIds: items
      .map((item) => item.mediaId)
      .filter((id): id is string => typeof id === "string"),
  };
}
