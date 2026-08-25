import { MAX_POST_ATTACHMENTS } from "@asm/media";
import { useEffect } from "react";

import { useComposerAttachmentStore } from "./attachment-store";

// Thin facade over the shared attachment store. Every PostEditor surface -
// inline feed editor, floating modal, mobile bar - consumes the SAME zustand
// state, so uploads and pipeline stages stay perfectly in sync across all of
// them. The store owns the logic; this hook only hydrates on first mount and
// preserves the long-standing call signature.

export type { Attachment } from "./attachment-store";

export default function useMediaUpload() {
  const attachments = useComposerAttachmentStore((s) => s.attachments);
  const cancelUpload = useComposerAttachmentStore((s) => s.cancelUpload);
  const hydrate = useComposerAttachmentStore((s) => s.hydrate);
  const isUploading = useComposerAttachmentStore((s) => s.isUploading);
  const removeAttachment = useComposerAttachmentStore(
    (s) => s.removeAttachment
  );
  const reorderAttachments = useComposerAttachmentStore(
    (s) => s.reorderAttachments
  );
  const reset = useComposerAttachmentStore((s) => s.reset);
  const retryUpload = useComposerAttachmentStore((s) => s.retryUpload);
  const startUpload = useComposerAttachmentStore((s) => s.startUpload);

  // Restore persisted drafts (and resume their watchers) once per app load.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return {
    MAX_POST_ATTACHMENTS,
    attachments,
    cancelUpload,
    isUploading,
    removeAttachment,
    reorderAttachments,
    reset,
    retryUpload,
    startUpload,
  };
}
