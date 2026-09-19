"use client";

import { MAX_MESSAGE_ATTACHMENTS } from "@asm/media";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { toast } from "@/lib/gooey-toast";
import { discardMessageMedia, uploadMessageMedia } from "@/lib/messages/client";

import type {
  GroupedMessageAttachments,
  MessageAttachmentDraft,
} from "./message-attachment-state";
import {
  groupReadyAttachments,
  hasUploading,
  isReadyToSend,
  kindForFile,
  selectAcceptedFiles,
} from "./message-attachment-state";

type AttachmentAction =
  | { drafts: MessageAttachmentDraft[]; type: "add" }
  | { id: string; patch: Partial<MessageAttachmentDraft>; type: "update" }
  | { id: string; type: "remove" }
  | { draft: MessageAttachmentDraft; id: string; type: "replace" }
  | { type: "clear" };

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
    case "clear": {
      return [];
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
export function useMessageAttachments(conversationId: string) {
  const [attachments, dispatch] = useReducer(attachmentReducer, []);
  const controllersRef = useRef(new Map<string, AbortController>());
  const progressRef = useRef(new Map<string, number>());
  // Server media ids keyed by draft id, captured as soon as the row exists (see
  // onMediaId) so a removal can discard it even while bytes are still in flight.
  const mediaIdsRef = useRef(new Map<string, string>());
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
      for (const mediaId of mediaIdsRef.current.values()) {
        void discardMessageMedia(mediaId);
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
            onMediaId: (mediaId) => {
              mediaIdsRef.current.set(draft.id, mediaId);
              dispatch({
                id: draft.id,
                patch: { mediaId },
                type: "update",
              });
            },
            onProgress: (percent) => {
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
              dispatch({ id: draft.id, patch: { stage }, type: "update" });
            },
            signal: controller.signal,
          }
        );
        controllersRef.current.delete(draft.id);
        progressRef.current.delete(draft.id);
        dispatch({
          id: draft.id,
          patch: {
            error: undefined,
            height: media.height,
            mediaUrl: media.url,
            progress: 100,
            status: "ready",
            width: media.width,
          },
          type: "update",
        });
      } catch (error) {
        controllersRef.current.delete(draft.id);
        progressRef.current.delete(draft.id);
        if (controller.signal.aborted) {
          return;
        }
        // A failed/aborted transfer leaves a server row behind; reclaim it since
        // it can never be sent.
        const failedMediaId = mediaIdsRef.current.get(draft.id);
        mediaIdsRef.current.delete(draft.id);
        if (failedMediaId) {
          void discardMessageMedia(failedMediaId);
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
    [conversationId]
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const { accepted, overflow, rejected } = selectAcceptedFiles(
        attachmentsRef.current.length,
        files
      );

      if (rejected > 0) {
        toast({
          description: "Messages support images and GIFs only.",
          title: "Unsupported File",
          variant: "destructive",
        });
      }
      if (overflow > 0) {
        toast({
          description: `You can send up to ${MAX_MESSAGE_ATTACHMENTS} images at a time.`,
          title: "Attachment Limit",
          variant: "destructive",
        });
      }
      if (accepted.length === 0) {
        return;
      }

      const drafts = accepted.map((file) => ({
        file,
        height: null,
        id: nextDraftId(),
        kind: kindForFile(file),
        objectUrl: URL.createObjectURL(file),
        progress: 0,
        stage: "uploading" as const,
        status: "uploading" as const,
        width: null,
      }));

      dispatch({ drafts, type: "add" });
      for (const draft of drafts) {
        void startUpload(draft);
      }
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
        const mediaId = mediaIdsRef.current.get(id);
        mediaIdsRef.current.delete(id);
        if (shouldDiscard && mediaId) {
          void discardMessageMedia(mediaId);
        }
      }
      for (const attachment of attachmentsRef.current) {
        if (idSet.has(attachment.id)) {
          URL.revokeObjectURL(attachment.objectUrl);
        }
      }
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

  const replaceAttachmentFile = useCallback(
    (id: string, file: File) => {
      controllersRef.current.get(id)?.abort();
      controllersRef.current.delete(id);
      progressRef.current.delete(id);
      const previousMediaId = mediaIdsRef.current.get(id);
      mediaIdsRef.current.delete(id);
      if (previousMediaId) {
        // The replaced upload is never sent; reclaim it instead of orphaning it.
        void discardMessageMedia(previousMediaId);
      }
      const target = attachmentsRef.current.find(
        (attachment) => attachment.id === id
      );
      if (target) {
        URL.revokeObjectURL(target.objectUrl);
      }
      const draft: MessageAttachmentDraft = {
        file,
        height: null,
        id,
        kind: kindForFile(file),
        objectUrl: URL.createObjectURL(file),
        progress: 0,
        stage: "uploading",
        status: "uploading",
        width: null,
      };
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

  const resetAttachments = useCallback(() => {
    for (const controller of controllersRef.current.values()) {
      controller.abort();
    }
    controllersRef.current.clear();
    progressRef.current.clear();
    for (const mediaId of mediaIdsRef.current.values()) {
      void discardMessageMedia(mediaId);
    }
    mediaIdsRef.current.clear();
    for (const attachment of attachmentsRef.current) {
      URL.revokeObjectURL(attachment.objectUrl);
    }
    dispatch({ type: "clear" });
  }, []);

  const readyGroups = useMemo(
    (): GroupedMessageAttachments[] => groupReadyAttachments(attachments),
    [attachments]
  );

  return {
    addFiles,
    attachments,
    canSend: isReadyToSend(attachments),
    isUploading: hasUploading(attachments),
    readyGroups,
    removeAttachment,
    removeAttachments,
    replaceAttachmentFile,
    resetAttachments,
    retryAttachment,
  };
}
