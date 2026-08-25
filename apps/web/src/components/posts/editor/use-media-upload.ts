import { clientLog } from "@asm/config/debug";
import { MAX_POST_ATTACHMENTS } from "@asm/media";
import { Upload } from "lucide-react";
import { createElement, useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/lib/gooey-toast";
import { uploadMediaFile } from "@/lib/media-upload-client";
import type { UploadStage } from "@/lib/media-upload-client";

// A completed upload is persisted to sessionStorage so a refresh or a quick
// navigation (e.g. scrolling the gusts feed) doesn't wipe the composer draft.
// Only the server media row + display metadata are stored - never the File
// object (it is not serializable); restored drafts render from mediaUrl.
const STORAGE_KEY = "asm-composer-attachments";
const STORAGE_VERSION = 1;

export interface Attachment {
  file?: File;
  isUploading: boolean;
  mediaId?: string;
  mediaUrl?: string;
  name?: string;
  progress: number;
  // Real pipeline phase from the status poll - drives the composer's stage
  // UI. Absent on restored drafts (already terminal).
  stage?: UploadStage;
  type?: string;
}

interface StoredAttachment {
  mediaId: string;
  name: string;
  type: string;
}

function loadStoredAttachments(): Attachment[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as {
      version?: number;
      items?: StoredAttachment[];
    };
    if (parsed.version !== STORAGE_VERSION) {
      return [];
    }
    return (parsed.items ?? []).map((item) => ({
      isUploading: false,
      mediaId: item.mediaId,
      // Restored drafts render straight from the serving URL.
      mediaUrl: `/api/media/${item.mediaId}`,
      name: item.name,
      progress: 100,
      type: item.type,
    }));
  } catch {
    return [];
  }
}

function persistAttachments(attachments: Attachment[]): void {
  if (typeof window === "undefined") {
    return;
  }
  const items: StoredAttachment[] = attachments
    .filter((attachment) => attachment.mediaId)
    .map((attachment) => ({
      mediaId: attachment.mediaId as string,
      name: attachment.name ?? attachment.file?.name ?? "attachment",
      type: attachment.type ?? attachment.file?.type ?? "",
    }));
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ items, version: STORAGE_VERSION })
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

export default function useMediaUpload() {
  const { toast } = useToast();
  // Start empty so the server-rendered HTML matches the first client render;
  // the saved draft is restored in an effect after hydration instead of in the
  // state initializer (sessionStorage is client-only, and reading it during
  // the initial render caused a hydration mismatch once images were persisted).
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const initialisedRef = useRef(false);
  // Per-file abort controllers keyed by file name, so a single attachment
  // can be cancelled mid-flight without touching its siblings.
  const controllersRef = useRef(new Map<string, AbortController>());

  // Keep sessionStorage in step with the current draft. After a manual remove
  // (or a successful submit via reset) the storage is cleared/updated too. The
  // first run restores any previously completed (not yet submitted)
  // attachments so a refresh/navigation doesn't discard the user's work.
  useEffect(() => {
    if (!initialisedRef.current) {
      initialisedRef.current = true;
      const stored = loadStoredAttachments();
      if (stored.length > 0) {
        // Deferred so the restored draft pops in right after the first paint
        // (hydration already matched on the empty state).
        queueMicrotask(() => setAttachments(stored));
      }
      return;
    }
    persistAttachments(attachments);
  }, [attachments]);

  async function handleStartUpload(incomingFiles: File[]) {
    if (isUploading) {
      toast({
        description: "One upload at a time, hang tight!",
        icon: createElement(Upload),
        title: "Upload in Progress",
      });
      return;
    }

    // Bunch guard: a drop/paste of e.g. 20 files keeps only what fits under
    // the post cap; the rest is discarded up front with an explicit count so
    // the user is never surprised by silently missing items.
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

    setIsUploading(true);
    setAttachments((prev) => [
      ...prev,
      ...files.map((file) => ({
        file,
        isUploading: true,
        progress: 0,
        stage: "uploading" as UploadStage,
      })),
    ]);

    try {
      await Promise.all(
        files.map(async (file) => {
          const controller = new AbortController();
          controllersRef.current.set(file.name, controller);
          try {
            const result = await uploadMediaFile(file, {
              onProgress: (percent) => {
                setAttachments((prev) =>
                  prev.map((attachment) =>
                    attachment.file === file
                      ? { ...attachment, progress: percent }
                      : attachment
                  )
                );
              },
              onStage: (stage) => {
                setAttachments((prev) =>
                  prev.map((attachment) =>
                    attachment.file === file
                      ? { ...attachment, stage }
                      : attachment
                  )
                );
              },
              purpose: "post",
              signal: controller.signal,
            });
            setAttachments((prev) =>
              prev.map((attachment) =>
                attachment.file === file
                  ? {
                      ...attachment,
                      isUploading: false,
                      mediaId: result.mediaId,
                      // Persisted drafts render from the serving URL after a
                      // refresh - the File object cannot survive one.
                      mediaUrl: `/api/media/${result.mediaId}`,
                      stage: undefined,
                    }
                  : attachment
              )
            );
          } catch (error: unknown) {
            // React Compiler cannot lower try/finally, so controller cleanup
            // happens explicitly on each exit path instead.
            controllersRef.current.delete(file.name);
            if (controller.signal.aborted) {
              // Deliberate cancel: drop local state quietly - the server-side
              // discard was already issued by removeAttachment before the
              // abort, and the abandoned-upload sweep is the backstop.
              setAttachments((prev) =>
                prev.filter((attachment) => attachment.file !== file)
              );
              return;
            }
            clientLog.error("Upload failed:", error);
            toast({
              description: "Couldn't upload that file, try again?",
              title: "Upload Failed",
              variant: "destructive",
            });
            setAttachments((prev) =>
              prev.filter((attachment) => attachment.file !== file)
            );
          }
          controllersRef.current.delete(file.name);
        })
      );
    } catch (error) {
      // Reset before rethrowing so the uploading flag clears on the failure
      // path too (replaces the previous `finally` clause).
      setIsUploading(false);
      throw error;
    }
    setIsUploading(false);
  }

  // Fire-and-forget server discard for an unclaimed draft upload. The
  // abandoned-upload sweep is the eventual backstop; this makes removal
  // instant instead of leaving orphaned bytes until the grace period lapses.
  const discardServerDraft = useCallback((mediaId: string | undefined) => {
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
  }, []);

  const removeAttachment = useCallback(
    (fileName: string) => {
      // If it is mid-flight, abort first - the aborted-catch cleans local
      // state without an error toast.
      controllersRef.current.get(fileName)?.abort();
      setAttachments((prev) => {
        const next = prev.filter((a) => (a.file?.name ?? a.name) !== fileName);
        // Completed-but-unposted drafts get immediate server cleanup.
        for (const removed of prev) {
          if ((removed.file?.name ?? removed.name) === fileName) {
            discardServerDraft(removed.mediaId);
          }
        }
        persistAttachments(next);
        return next;
      });
    },
    [discardServerDraft]
  );

  /** Graceful in-flight cancel for one attachment (X button on its tile).
   * Same mechanics as removal: abort the transfer, discard any already-
   * initiated server draft, drop local state. */
  const cancelUpload = useCallback(
    (fileName: string) => {
      removeAttachment(fileName);
    },
    [removeAttachment]
  );

  /** Drag-reorder target: replaces the draft order wholesale. */
  const reorderAttachments = useCallback((ordered: Attachment[]) => {
    setAttachments(ordered);
  }, []);

  function reset() {
    // Successful submit: attachments are now owned by the post, so nothing
    // is discarded server-side - only local draft state goes away.
    controllersRef.current.clear();
    setAttachments([]);
    clearStoredAttachments();
  }

  return {
    MAX_POST_ATTACHMENTS,
    attachments,
    cancelUpload,
    isUploading,
    removeAttachment,
    reorderAttachments,
    reset,
    startUpload: handleStartUpload,
  };
}
