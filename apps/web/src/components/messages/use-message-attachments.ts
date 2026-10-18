"use client";

import { MAX_MESSAGE_ATTACHMENTS } from "@asm/media";
import { shouldAutoEditPhoto } from "@asm/ui/lib/photo-editing";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { toast } from "@/lib/gooey-toast";
import { discardMessageMedia, uploadMessageMedia } from "@/lib/messages/client";

import {
  claimStagedMedia,
  groupReadyAttachments,
  hasUploading,
  isMediaReferenced,
  isReadyToSend,
  kindForFile,
  restoreStagedMedia,
  selectAcceptedFiles,
} from "./message-attachment-state";
import type {
  GroupedMessageAttachments,
  MessageAttachmentDraft,
  StagedMediaId,
} from "./message-attachment-state";

type AttachmentAction =
  | { drafts: MessageAttachmentDraft[]; type: "add" }
  | { id: string; patch: Partial<MessageAttachmentDraft>; type: "update" }
  | { id: string; type: "remove" }
  | { draft: MessageAttachmentDraft; id: string; type: "replace" };

function attachmentReducer(
  state: MessageAttachmentDraft[],
  action: AttachmentAction
): MessageAttachmentDraft[] {
  switch (action.type) {
    case "add": {
      return [...state, ...action.drafts];
    }
    case "update": {
      return state.map((attachment) =>
        attachment.id === action.id
          ? { ...attachment, ...action.patch }
          : attachment
      );
    }
    case "remove": {
      return state.filter((attachment) => attachment.id !== action.id);
    }
    case "replace": {
      return state.map((attachment) =>
        attachment.id === action.id ? action.draft : attachment
      );
    }
    default: {
      return state;
    }
  }
}

let draftCounter = 0;

function nextDraftId(): string {
  draftCounter += 1;
  return `msg-attachment-${Date.now()}-${draftCounter}`;
}

// Stages up to MAX_MESSAGE_ATTACHMENTS images for a message send. Each accepted
// file gets an object URL for instant preview and starts uploading in parallel;
// the composer sends only once every attachment is READY (the serving route
// gates on that status). Uploads are abortable so removing a tile or unmounting
// the thread stops the work instead of leaking a request.
export function useMessageAttachments(
  conversationId: string,
  incognitoSessionId?: string
) {
  const [attachments, dispatch] = useReducer(attachmentReducer, []);
  const controllersRef = useRef(new Map<string, AbortController>());
  const progressRef = useRef(new Map<string, number>());
  // Server media rows keyed by draft id, captured as soon as the row exists
  // (see onMediaId) so a removal can discard it even while bytes are still in
  // flight. `owned` guards against discarding deduped rows.
  const mediaIdsRef = useRef(new Map<string, StagedMediaId>());
  const attachmentsRef = useRef(attachments);

  useEffect(() => {
    // Keep the latest list available to the imperative callbacks for cap checks
    // without making every callback depend on (and re-create for) the array.
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(
    () => () => {
      // Unmount: abort in-flight uploads, discard any server rows the sender
      // staged but never sent, and release every preview URL.
      for (const controller of controllersRef.current.values()) {
        controller.abort();
      }
      controllersRef.current.clear();
      for (const entry of mediaIdsRef.current.values()) {
        if (entry.owned) {
          void discardMessageMedia(entry.mediaId);
        }
      }
      mediaIdsRef.current.clear();
      for (const attachment of attachmentsRef.current) {
        URL.revokeObjectURL(attachment.objectUrl);
      }
    },
    []
  );

  const startUpload = useCallback(
    async (draft: MessageAttachmentDraft) => {
      const controller = new AbortController();
      let uploadedEntry: StagedMediaId | undefined;
      controllersRef.current.set(draft.id, controller);
      progressRef.current.set(draft.id, 0);

      dispatch({
        id: draft.id,
        patch: {
          error: undefined,
          progress: 0,
          stage: "uploading",
          status: "uploading",
        },
        type: "update",
      });

      try {
        const media = await uploadMessageMedia(
          draft.file,
          draft.kind,
          conversationId,
          {
            incognitoSessionId,
            onMediaId: (mediaId, meta) => {
              uploadedEntry = { mediaId, owned: meta.owned };
              if (
                controller.signal.aborted ||
                controllersRef.current.get(draft.id) !== controller
              ) {
                if (meta.owned) {
                  void discardMessageMedia(mediaId);
                }
                return;
              }
              mediaIdsRef.current.set(draft.id, {
                mediaId,
                owned: meta.owned,
              });
              dispatch({
                id: draft.id,
                patch: { mediaId },
                type: "update",
              });
            },
            onProgress: (percent) => {
              if (
                controller.signal.aborted ||
                controllersRef.current.get(draft.id) !== controller
              ) {
                return;
              }
              // Progress events fire far more often than the UI needs; only
              // commit a render when the integer percentage actually moves.
              const rounded = Math.round(percent);
              if (progressRef.current.get(draft.id) === rounded) {
                return;
              }
              progressRef.current.set(draft.id, rounded);
              dispatch({
                id: draft.id,
                patch: { progress: rounded },
                type: "update",
              });
            },
            onStage: (stage) => {
              if (
                controller.signal.aborted ||
                controllersRef.current.get(draft.id) !== controller
              ) {
                return;
              }
              dispatch({ id: draft.id, patch: { stage }, type: "update" });
            },
            signal: controller.signal,
            viewOnce: draft.viewOnce,
          }
        );
        if (
          controller.signal.aborted ||
          controllersRef.current.get(draft.id) !== controller
        ) {
          if (uploadedEntry?.owned) {
            void discardMessageMedia(uploadedEntry.mediaId);
          }
          return;
        }
        controllersRef.current.delete(draft.id);
        progressRef.current.delete(draft.id);
        dispatch({
          id: draft.id,
          patch: {
            bytes: media.bytes,
            durationSec: media.durationSec,
            error: undefined,
            height: media.height,
            mediaUrl: media.url,
            mimeType: media.mimeType,
            progress: 100,
            status: "ready",
            width: media.width,
          },
          type: "update",
        });
      } catch (error) {
        if (controllersRef.current.get(draft.id) !== controller) {
          return;
        }
        controllersRef.current.delete(draft.id);
        progressRef.current.delete(draft.id);
        if (controller.signal.aborted) {
          return;
        }
        // A failed/aborted transfer leaves a server row behind; reclaim it since
        // it can never be sent (unless another draft still references it).
        const failedEntry = mediaIdsRef.current.get(draft.id);
        mediaIdsRef.current.delete(draft.id);
        if (
          failedEntry?.owned &&
          !isMediaReferenced(
            mediaIdsRef.current,
            failedEntry.mediaId,
            new Set([draft.id])
          )
        ) {
          void discardMessageMedia(failedEntry.mediaId);
        }
        dispatch({
          id: draft.id,
          patch: {
            error: error instanceof Error ? error.message : "Upload failed",
            status: "error",
          },
          type: "update",
        });
      }
    },
    [conversationId, incognitoSessionId]
  );

  const addFiles = useCallback(
    (
      files: File[],
      options: { viewOnce?: boolean; editSinglePhoto?: boolean } = {}
    ) => {
      if (
        !options.viewOnce &&
        attachmentsRef.current.some((item) => item.viewOnce)
      ) {
        return;
      }
      if (options.viewOnce) {
        const supported =
          files.length === 1 &&
          ["image/jpeg", "image/png", "image/webp", "image/avif"].includes(
            files[0]?.type.toLowerCase() ?? ""
          );
        if (!supported || attachmentsRef.current.length > 0) {
          toast({
            description: "Choose one JPEG, PNG, WebP, or AVIF photo.",
            title: "View once photo",
            variant: "destructive",
          });
          return;
        }
      }
      const { accepted, overflow, rejected, tooLarge } = selectAcceptedFiles(
        options.viewOnce ? 0 : attachmentsRef.current.length,
        files,
        options.viewOnce
          ? 0
          : attachmentsRef.current.reduce(
              (total, attachment) => total + attachment.bytes,
              0
            )
      );

      if (rejected > 0) {
        toast({
          description: "Choose photos, videos, audio, PDF, or Office files.",
          title: "Unsupported File",
          variant: "destructive",
        });
      }
      if (tooLarge > 0) {
        toast({
          description: "One or more files exceed the message size limit.",
          title: "Attachment Too Large",
          variant: "destructive",
        });
      }
      if (overflow > 0) {
        toast({
          description: `You can send up to ${MAX_MESSAGE_ATTACHMENTS} attachments at a time.`,
          title: "Attachment Limit",
          variant: "destructive",
        });
      }
      if (accepted.length === 0) {
        return;
      }

      const drafts = accepted.map((file) => ({
        bytes: file.size,
        durationSec: null,
        file,
        filename: file.name,
        height: null,
        id: nextDraftId(),
        kind: kindForFile(file),
        mimeType: file.type,
        objectUrl: URL.createObjectURL(file),
        progress: 0,
        stage: "uploading" as const,
        status: "uploading" as const,
        viewOnce: options.viewOnce ?? false,
        width: null,
      }));

      // Optimistically advance the ref used for capacity checks: the effect
      // that syncs it from state runs after commit, so two adds in the same
      // tick (e.g. paste + drop) could otherwise each see the old length and
      // together exceed the cap.
      const editId =
        options.editSinglePhoto &&
        attachmentsRef.current.length === 0 &&
        shouldAutoEditPhoto(files.length, drafts)
          ? drafts[0].id
          : undefined;
      attachmentsRef.current = [...attachmentsRef.current, ...drafts];
      dispatch({ drafts, type: "add" });
      if (!editId) {
        for (const draft of drafts) {
          void startUpload(draft);
        }
      }
      return { drafts, editId };
    },
    [startUpload]
  );

  const removeAttachments = useCallback(
    (ids: string[], options?: { discard?: boolean }) => {
      const shouldDiscard = options?.discard ?? true;
      const idSet = new Set(ids);
      for (const id of ids) {
        controllersRef.current.get(id)?.abort();
        controllersRef.current.delete(id);
        progressRef.current.delete(id);
        const entry = mediaIdsRef.current.get(id);
        mediaIdsRef.current.delete(id);
        if (
          shouldDiscard &&
          entry?.owned &&
          !isMediaReferenced(mediaIdsRef.current, entry.mediaId, idSet)
        ) {
          void discardMessageMedia(entry.mediaId);
        }
      }
      for (const attachment of attachmentsRef.current) {
        if (idSet.has(attachment.id)) {
          URL.revokeObjectURL(attachment.objectUrl);
        }
      }
      attachmentsRef.current = attachmentsRef.current.filter(
        (attachment) => !idSet.has(attachment.id)
      );
      for (const id of ids) {
        dispatch({ id, type: "remove" });
      }
    },
    []
  );

  const removeAttachment = useCallback(
    (id: string) => {
      removeAttachments([id]);
    },
    [removeAttachments]
  );

  // Takes a group out of staging before its send is attempted, so the unmount
  // sweep above can no longer discard rows the server may already reference.
  // Returns the detached entries for restoreAttachments if the send fails.
  const claimAttachments = useCallback(
    (ids: string[]): Map<string, StagedMediaId> => {
      for (const id of ids) {
        controllersRef.current.get(id)?.abort();
        controllersRef.current.delete(id);
        progressRef.current.delete(id);
      }
      return claimStagedMedia(mediaIdsRef.current, ids);
    },
    []
  );

  // Re-stages a claimed group after a send that never landed, so those rows
  // are still reclaimed when the sender removes them or leaves the thread.
  const restoreAttachments = useCallback(
    (claimed: Map<string, StagedMediaId>) => {
      restoreStagedMedia(mediaIdsRef.current, claimed);
    },
    []
  );

  const replaceAttachmentFile = useCallback(
    (id: string, file: File, options: { viewOnce?: boolean } = {}) => {
      const target = attachmentsRef.current.find(
        (attachment) => attachment.id === id
      );
      if (!target) {
        return;
      }
      const viewOnce = options.viewOnce ?? target.viewOnce ?? false;
      if (
        viewOnce &&
        (attachmentsRef.current.length !== 1 || kindForFile(file) !== "image")
      ) {
        return;
      }
      controllersRef.current.get(id)?.abort();
      controllersRef.current.delete(id);
      progressRef.current.delete(id);
      const previousEntry = mediaIdsRef.current.get(id);
      mediaIdsRef.current.delete(id);
      if (
        previousEntry?.owned &&
        !isMediaReferenced(
          mediaIdsRef.current,
          previousEntry.mediaId,
          new Set([id])
        )
      ) {
        // The replaced upload is never sent; reclaim it instead of orphaning it.
        void discardMessageMedia(previousEntry.mediaId);
      }
      URL.revokeObjectURL(target.objectUrl);
      const draft: MessageAttachmentDraft = {
        bytes: file.size,
        durationSec: null,
        file,
        filename: file.name,
        height: null,
        id,
        kind: kindForFile(file),
        mimeType: file.type,
        objectUrl: URL.createObjectURL(file),
        progress: 0,
        stage: "uploading",
        status: "uploading",
        viewOnce,
        width: null,
      };
      attachmentsRef.current = attachmentsRef.current.map((attachment) =>
        attachment.id === id ? draft : attachment
      );
      dispatch({ draft, id, type: "replace" });
      void startUpload(draft);
    },
    [startUpload]
  );

  const retryAttachment = useCallback(
    (id: string) => {
      const target = attachmentsRef.current.find(
        (attachment) => attachment.id === id
      );
      if (!target || target.status === "uploading") {
        return;
      }
      void startUpload({ ...target });
    },
    [startUpload]
  );

  const readyGroups = useMemo(
    (): GroupedMessageAttachments[] => groupReadyAttachments(attachments),
    [attachments]
  );

  const resumeAttachmentUpload = useCallback(
    (id: string) => {
      const draft = attachmentsRef.current.find((item) => item.id === id);
      if (draft?.status === "uploading" && !controllersRef.current.has(id)) {
        void startUpload(draft);
      }
    },
    [startUpload]
  );

  return {
    addFiles,
    attachments,
    canSend: isReadyToSend(attachments),
    claimAttachments,
    isUploading: hasUploading(attachments),
    readyGroups,
    removeAttachment,
    removeAttachments,
    replaceAttachmentFile,
    restoreAttachments,
    resumeAttachmentUpload,
    retryAttachment,
  };
}
