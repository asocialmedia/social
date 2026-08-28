import { clientLog } from "@asm/config/debug";
import { MAX_POST_ATTACHMENTS } from "@asm/media";
import { toast } from "@asm/ui/lib/gooey-toast";
import { Upload } from "lucide-react";
import { createElement } from "react";
import { create } from "zustand";

import {
  patchAltText,
  rejectionCopy,
  uploadMediaFile,
  watchMediaStatus,
} from "@/lib/media-upload-client";
import type {
  StatusWatchOutcome,
  UploadStage,
} from "@/lib/media-upload-client";
import type { ComposerMode } from "@/store/composer-store";
import { useComposerStore } from "@/store/composer-store";

// Single source of truth for composer attachments. Every PostEditor instance
// (inline feed editor, floating modal, mobile bar) mounts the SAME zustand
// store, so an upload started in one surface appears - with live pipeline
// stages - in all of them simultaneously.

// A completed upload is persisted to sessionStorage so a refresh or a quick
// navigation doesn't wipe the draft. Only the server media row + display
// metadata are stored - never the File object (it is not serializable);
// restored drafts render from mediaUrl. The composer mode the draft was
// authored in rides along: a gust video must reopen in the gust editor, not
// as a fleet attachment.
const STORAGE_KEY = "asm-composer-attachments";
const STORAGE_VERSION = 2;

export interface Attachment {
  altText?: string;
  error?: string;
  file?: File;
  isUploading: boolean;
  mediaId?: string;
  mediaUrl?: string;
  name?: string;
  progress: number;
  // Real pipeline phase from the status poll - drives the stage UI. Absent
  // on fully-settled drafts.
  stage?: UploadStage;
  type?: string;
  // True when bytes finished but READY hasn't been observed yet in ANY
  // editor - a watcher keeps the stages flowing across remounts.
  resuming?: boolean;
}

interface StoredAttachment {
  altText?: string;
  mediaId: string;
  name: string;
  resuming?: boolean;
  type: string;
}

interface StoredDraft {
  items?: StoredAttachment[];
  mode?: ComposerMode;
  version?: number;
}

function loadStoredDraft(): {
  attachments: Attachment[];
  mode?: ComposerMode;
} {
  if (typeof window === "undefined") {
    return { attachments: [] };
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { attachments: [] };
    }
    const parsed = JSON.parse(raw) as StoredDraft;
    if (parsed.version !== STORAGE_VERSION) {
      return { attachments: [] };
    }
    const attachments = (parsed.items ?? []).map((item) => ({
      altText: item.altText,
      ...(item.resuming
        ? { isUploading: true, resuming: true, stage: "queued" as UploadStage }
        : { isUploading: false }),
      mediaId: item.mediaId,
      // Restored drafts render straight from the serving URL.
      mediaUrl: `/api/media/${item.mediaId}`,
      name: item.name,
      progress: 100,
      type: item.type,
    }));
    return {
      attachments,
      // A mode is only meaningful alongside a real draft; an emptied draft
      // must not pin the next fresh composer to gust.
      mode: attachments.length > 0 ? parsed.mode : undefined,
    };
  } catch {
    return { attachments: [] };
  }
}

function persistAttachments(attachments: Attachment[]): void {
  if (typeof window === "undefined") {
    return;
  }
  const items: StoredAttachment[] = attachments
    .filter((attachment) => attachment.mediaId)
    .map((attachment) => ({
      altText: attachment.altText || undefined,
      mediaId: attachment.mediaId as string,
      name: attachment.name ?? attachment.file?.name ?? "attachment",
      resuming: attachment.isUploading || undefined,
      type: attachment.type ?? attachment.file?.type ?? "",
    }));
  // The draft's composer mode is captured live at every persist so a refresh
  // always reopens the composer exactly as the draft was left.
  const mode: ComposerMode | undefined =
    items.length > 0 ? useComposerStore.getState().mode : undefined;
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        items,
        mode,
        version: STORAGE_VERSION,
      } satisfies StoredDraft)
    );
  } catch {
    // Storage may be unavailable; the draft is simply not persisted.
  }
}

function clearStoredAttachments(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}

// Non-serializable per-file abort controllers live outside the store.
const controllers = new Map<string, AbortController>();
let hydrated = false;

// Fire-and-forget server discard for an unclaimed draft upload. The
// abandoned-upload sweep remains the eventual backstop; this makes removal
// instant instead of leaving orphaned bytes until the grace period lapses.
function discardServerDraft(mediaId: string | undefined): void {
  if (!mediaId) {
    return;
  }
  void (async () => {
    try {
      await fetch(`/api/media/${mediaId}/draft-discard`, {
        credentials: "same-origin",
        method: "DELETE",
      });
    } catch {
      // Network hiccups leave the sweep as backstop.
    }
  })();
}

interface ComposerAttachmentState {
  attachments: Attachment[];
  cancelUpload: (fileName: string) => void;
  /** One-shot: restore persisted drafts and resume their pipeline watchers. */
  hydrate: () => void;
  isUploading: boolean;
  removeAttachment: (fileName: string) => void;
  reorderAttachments: (ordered: Attachment[]) => void;
  reset: () => void;
  retryUpload: (fileName: string) => Promise<void>;
  setAltText: (fileName: string, altText: string) => void;
  startUpload: (
    incomingFiles: File[],
    opts?: { audioOverlayId?: string | null }
  ) => Promise<void>;
}

export const useComposerAttachmentStore = create<ComposerAttachmentState>()((
  set,
  get
) => {
  /** Single mutation funnel: swap the list, then mirror it to storage. */
  const commit = (next: Attachment[]): void => {
    persistAttachments(next);
    set({ attachments: next });
  };

  const dropAttachment = (fileName: string): void => {
    commit(
      get().attachments.filter((a) => (a.file?.name ?? a.name) !== fileName)
    );
  };

  // Alt text typed before the media row existed (upload still initiating)
  // saves to the server the moment initiate lands. Later edits go out
  // immediately from setAltText.
  const flushPendingAltText = (fileName: string): void => {
    const target = get().attachments.find(
      (a) => (a.file?.name ?? a.name) === fileName
    );
    const { altText, mediaId } = target ?? {};
    if (!mediaId || !altText) {
      return;
    }
    void (async () => {
      const ok = await patchAltText(mediaId, altText);
      if (!ok) {
        clientLog.error("Failed to save alt text for:", fileName);
      }
    })();
  };

  function applyWatchOutcome(
    mediaId: string,
    outcome: StatusWatchOutcome
  ): void {
    if (outcome.status === "DETACHED") {
      // Keep the resuming marker; the next hydrate() re-attaches.
      return;
    }
    if (outcome.status === "REJECTED") {
      toast({
        description: rejectionCopy(outcome.rejectedReason),
        title: "Attachment Removed",
        variant: "destructive",
      });
      commit(get().attachments.filter((a) => a.mediaId !== mediaId));
      return;
    }
    commit(
      get().attachments.map((a) =>
        a.mediaId === mediaId
          ? { ...a, isUploading: false, resuming: false, stage: undefined }
          : a
      )
    );
  }

  return {
    attachments: [],
    cancelUpload: (fileName) => {
      // Same mechanics as removal: abort the transfer, discard any
      // already-initiated server draft, drop local state.
      get().removeAttachment(fileName);
    },
    hydrate: () => {
      if (hydrated) {
        return;
      }
      hydrated = true;
      const stored = loadStoredDraft();
      if (stored.attachments.length === 0) {
        return;
      }
      // The draft was authored in a specific composer mode; put the composer
      // back there so the restored video lands in its own upload area (gust
      // editor) instead of presenting itself as a fleet attachment.
      const composer = useComposerStore.getState();
      if (stored.mode && composer.mode !== stored.mode) {
        composer.setMode(stored.mode);
      }
      // Deferred so the restored draft pops in right after the first paint.
      queueMicrotask(() => set({ attachments: stored.attachments }));
      for (const item of stored.attachments.filter(
        (s) => s.resuming && s.mediaId
      )) {
        void (async () => {
          try {
            const outcome = await watchMediaStatus(item.mediaId as string, {
              onStage: (stage) => {
                set({
                  attachments: get().attachments.map((a) =>
                    a.mediaId === item.mediaId ? { ...a, stage } : a
                  ),
                });
              },
            });
            applyWatchOutcome(item.mediaId as string, outcome);
          } catch {
            // Auth loss during watch: leave the resuming tile; the next
            // hydrate retries once the user signs back in.
          }
        })();
      }
    },
    isUploading: false,
    removeAttachment: (fileName) => {
      // Abort mid-flight first - the aborted-catch cleans quietly.
      controllers.get(fileName)?.abort();
      const removed = get().attachments.find(
        (a) => (a.file?.name ?? a.name) === fileName
      );
      if (removed) {
        discardServerDraft(removed.mediaId);
      }
      dropAttachment(fileName);
    },
    reorderAttachments: (ordered) => {
      commit(ordered);
    },
    reset: () => {
      // Successful submit: attachments are now owned by the post, so
      // nothing is discarded server-side - only draft state goes away.
      controllers.clear();
      clearStoredAttachments();
      set({ attachments: [], isUploading: false });
    },
    retryUpload: async (fileName) => {
      const target = get().attachments.find(
        (a) => (a.file?.name ?? a.name) === fileName
      );
      if (!target || target.isUploading || get().isUploading) {
        return;
      }
      const { file, mediaId, stage: lastStage } = target;

      // If we already have a mediaId and the failure was past the byte upload
      // (queued/scanning/processing or timeout), resume by re-watching the
      // pipeline instead of re-uploading bytes.
      const canResumeWatch =
        Boolean(mediaId) &&
        lastStage !== "uploading" &&
        (target.resuming || target.error?.includes("Still processing"));

      if (canResumeWatch && mediaId) {
        set({ isUploading: true });
        commit(
          get().attachments.map((a) =>
            (a.file?.name ?? a.name) === fileName
              ? { ...a, error: undefined, isUploading: true, resuming: true }
              : a
          )
        );
        try {
          const outcome = await watchMediaStatus(mediaId, {
            onStage: (stage) => {
              set({
                attachments: get().attachments.map((a) =>
                  (a.file?.name ?? a.name) === fileName ? { ...a, stage } : a
                ),
              });
            },
          });
          if (outcome.status === "READY") {
            commit(
              get().attachments.map((a) =>
                (a.file?.name ?? a.name) === fileName
                  ? {
                      ...a,
                      error: undefined,
                      isUploading: false,
                      resuming: false,
                      stage: undefined,
                    }
                  : a
              )
            );
            persistAttachments(get().attachments);
          } else if (outcome.status === "REJECTED") {
            toast({
              description: rejectionCopy(outcome.rejectedReason),
              title: "Attachment Removed",
              variant: "destructive",
            });
            commit(
              get().attachments.filter(
                (a) => (a.file?.name ?? a.name) !== fileName
              )
            );
          } else {
            // DETACHED again - keep retryable
            commit(
              get().attachments.map((a) =>
                (a.file?.name ?? a.name) === fileName
                  ? {
                      ...a,
                      error: "Still processing - check back in a moment",
                      isUploading: false,
                    }
                  : a
              )
            );
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Watch failed";
          commit(
            get().attachments.map((a) =>
              (a.file?.name ?? a.name) === fileName
                ? { ...a, error: message, isUploading: false }
                : a
            )
          );
        } finally {
          set({ isUploading: false });
        }
        return;
      }

      // Otherwise re-upload the original bytes (failed during initiate/PUT/finalize)
      if (!file) {
        toast({
          description: "Original file unavailable - please re-select it",
          title: "Retry Failed",
          variant: "destructive",
        });
        return;
      }
      const controller = new AbortController();
      controllers.set(file.name, controller);
      set({ isUploading: true });
      commit(
        get().attachments.map((a) =>
          (a.file?.name ?? a.name) === fileName
            ? {
                ...a,
                error: undefined,
                isUploading: true,
                progress: 0,
                stage: "uploading" as UploadStage,
              }
            : a
        )
      );
      try {
        const result = await uploadMediaFile(file, {
          onProgress: (percent) => {
            set({
              attachments: get().attachments.map((a) =>
                (a.file?.name ?? a.name) === fileName
                  ? { ...a, progress: percent }
                  : a
              ),
            });
          },
          onStage: (stage) => {
            set({
              attachments: get().attachments.map((a) =>
                (a.file?.name ?? a.name) === fileName ? { ...a, stage } : a
              ),
            });
          },
          purpose: "post",
          signal: controller.signal,
        });
        if (result.status === "REJECTED") {
          toast({
            description: rejectionCopy(result.rejectedReason),
            title: "Attachment Removed",
            variant: "destructive",
          });
          commit(
            get().attachments.filter(
              (a) => (a.file?.name ?? a.name) !== fileName
            )
          );
        } else {
          commit(
            get().attachments.map((a) =>
              (a.file?.name ?? a.name) === fileName
                ? {
                    ...a,
                    error: undefined,
                    isUploading: false,
                    mediaId: result.mediaId,
                    mediaUrl: `/api/media/${result.mediaId}`,
                    stage: undefined,
                  }
                : a
            )
          );
          persistAttachments(get().attachments);
          flushPendingAltText(fileName);
        }
      } catch (error: unknown) {
        controllers.delete(file.name);
        if (controller.signal.aborted) {
          dropAttachment(file.name);
          return;
        }
        clientLog.error("Retry failed:", error);
        const message =
          error instanceof Error ? error.message : "Upload failed";
        const isTimeout = message.includes("Still processing");
        toast({
          description: isTimeout
            ? "Still processing - you can retry again"
            : "Retry failed - try again?",
          title: isTimeout ? "Processing Delayed" : "Upload Failed",
          variant: "destructive",
        });
        commit(
          get().attachments.map((a) =>
            (a.file?.name ?? a.name) === fileName
              ? {
                  ...a,
                  error: message,
                  isUploading: false,
                  resuming: isTimeout ? true : undefined,
                }
              : a
          )
        );
      }
      controllers.delete(file.name);
      set({ isUploading: false });
    },
    setAltText: (fileName, altText) => {
      const target = get().attachments.find(
        (a) => (a.file?.name ?? a.name) === fileName
      );
      if (!target) {
        return;
      }
      commit(
        get().attachments.map((a) =>
          (a.file?.name ?? a.name) === fileName ? { ...a, altText } : a
        )
      );
      // The media row exists from initiation onward, so edits save
      // immediately; pre-initiation edits stay local until
      // flushPendingAltText runs once the row lands.
      if (target.mediaId) {
        void (async () => {
          const ok = await patchAltText(target.mediaId as string, altText);
          if (!ok) {
            clientLog.error("Failed to save alt text for:", fileName);
          }
        })();
      }
    },
    startUpload: async (incomingFiles, opts) => {
      const { attachments, isUploading } = get();
      if (isUploading) {
        toast({
          description: "One upload at a time, hang tight!",
          icon: createElement(Upload),
          title: "Upload in Progress",
        });
        return;
      }

      // Bunch guard: oversized drops keep only what fits under the cap.
      let files = incomingFiles;
      const remainingCapacity = MAX_POST_ATTACHMENTS - attachments.length;
      if (files.length > remainingCapacity) {
        const kept = files.slice(0, Math.max(remainingCapacity, 0));
        const discarded = files.length - kept.length;
        toast({
          description:
            kept.length === 0
              ? `Only ${MAX_POST_ATTACHMENTS} items at a time - remove something first.`
              : `Only ${MAX_POST_ATTACHMENTS} items at a time - kept the first ${kept.length}, skipped ${discarded}.`,
          title: "Attachment Limit",
          variant: "destructive",
        });
        if (kept.length === 0) {
          return;
        }
        files = kept;
      }

      set({ isUploading: true });
      commit([
        ...attachments,
        ...files.map((file) => ({
          file,
          isUploading: true,
          progress: 0,
          stage: "uploading" as UploadStage,
        })),
      ]);

      await Promise.all(
        files.map(async (file) => {
          const controller = new AbortController();
          controllers.set(file.name, controller);
          try {
            const result = await uploadMediaFile(file, {
              audioOverlayId: opts?.audioOverlayId ?? undefined,
              onProgress: (percent) => {
                set({
                  attachments: get().attachments.map((a) =>
                    a.file === file ? { ...a, progress: percent } : a
                  ),
                });
              },
              onStage: (stage) => {
                set({
                  attachments: get().attachments.map((a) =>
                    a.file === file ? { ...a, stage } : a
                  ),
                });
              },
              purpose: "post",
              signal: controller.signal,
            });
            if (result.status === "REJECTED") {
              toast({
                description: rejectionCopy(result.rejectedReason),
                title: "Attachment Removed",
                variant: "destructive",
              });
              commit(
                get().attachments.filter(
                  (a) => (a.file?.name ?? a.name) !== file.name
                )
              );
            } else {
              set({
                attachments: get().attachments.map((a) =>
                  a.file === file
                    ? {
                        ...a,
                        isUploading: false,
                        mediaId: result.mediaId,
                        mediaUrl: `/api/media/${result.mediaId}`,
                        stage: undefined,
                      }
                    : a
                ),
              });
              persistAttachments(get().attachments);
              flushPendingAltText(file.name);
            }
          } catch (error: unknown) {
            // React Compiler cannot lower try/finally; cleanup happens on
            // each exit path explicitly.
            controllers.delete(file.name);
            if (controller.signal.aborted) {
              // Deliberate cancel: quiet local cleanup - the server-side
              // discard was issued by removeAttachment before the abort.
              dropAttachment(file.name);
              return;
            }
            clientLog.error("Upload failed:", error);
            const message =
              error instanceof Error ? error.message : "Upload failed";
            const isTimeout = message.includes("Still processing");
            toast({
              description: isTimeout
                ? "Upload timed out - tap retry to continue where it left off"
                : "Couldn't upload that file, try again?",
              title: isTimeout ? "Processing Delayed" : "Upload Failed",
              variant: "destructive",
            });
            // Keep the tile for retry instead of dropping it - preserve the
            // file so retry can resume from the last stage (re-upload or re-watch).
            commit(
              get().attachments.map((a) =>
                a.file === file
                  ? {
                      ...a,
                      error: message,
                      isUploading: false,
                      resuming: isTimeout ? true : undefined,
                    }
                  : a
              )
            );
          }
          controllers.delete(file.name);
        })
      );
      set({ isUploading: false });
    },
  };
});

// Keep the persisted draft's mode in lockstep with the composer toggle: a
// gust draft switched to fleet (ModeToggle) must survive a refresh as a
// fleet draft, and vice versa. Only drafts with attachments carry a mode.
if (typeof window !== "undefined") {
  useComposerStore.subscribe((state, prevState) => {
    if (state.mode === prevState.mode) {
      return;
    }
    const { attachments } = useComposerAttachmentStore.getState();
    if (attachments.length === 0) {
      return;
    }
    persistAttachments(attachments);
  });
}

/** Test seam: allows isolation between store-touching tests. */
export function __resetComposerAttachmentStoreForTests(): void {
  hydrated = false;
  controllers.clear();
  useComposerAttachmentStore.setState({
    attachments: [],
    isUploading: false,
  });
  clearStoredAttachments();
}
