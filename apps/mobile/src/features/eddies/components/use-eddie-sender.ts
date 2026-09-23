// Shared send logic for the inline eddie composer and the floating bar,
// ported from web's CommentInput + use-comment-attachments:
// - draft text per (post, parent) that survives unmounts
// - one attachment, images and GIFs only, uploaded with purpose "comment"
//   and waited on until READY (the server re-checks ownership and type)
// - limits: 2000 words / 10000 chars, counter from 80%
// - send posts through POST /api/posts/:id/comments, merges the returned
//   eddie into the thread, clears the draft, toasts like web
import { useState } from "react";

import { toast } from "@/components/feedback/toast";
import {
  downloadGif,
  pickPhotosAndVideos,
} from "@/features/composer/lib/pick-media";
import type { KlipyGif } from "@/features/composer/lib/pick-media";
import { createEddie } from "@/features/composer/lib/publish-api";
import type { FeedComment } from "@/features/feed/lib/feed-api";
import { MAX_COMMENT_ATTACHMENTS } from "@/features/media-upload/lib/upload-policy";
import {
  attachmentActions,
  scopeReadiness,
  useScopeAttachments,
} from "@/features/media-upload/state/attachment-store";
import type { PickedMedia } from "@/features/media-upload/state/attachment-store";

import { emitEddieCreated } from "../lib/eddie-events";
import {
  eddieDraftKey,
  useEddieComposerStore,
} from "../state/eddie-composer-store";

export const MAX_EDDIE_WORDS = 2000;
export const MAX_EDDIE_CHARS = 10_000;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function useEddieSender(postId: string, parentId?: string | null) {
  const key = eddieDraftKey(postId, parentId);
  const scope = `eddie:${postId}:${parentId ?? "root"}`;
  const text = useEddieComposerStore((state) => state.drafts[key] ?? "");
  const setDraft = useEddieComposerStore((state) => state.setDraft);
  const attachments = useScopeAttachments(scope);
  const [sending, setSending] = useState(false);

  const { hasError, isBusy, mediaIds } = scopeReadiness(attachments);
  const words = wordCount(text);
  const nearLimit =
    words >= MAX_EDDIE_WORDS * 0.8 || text.length >= MAX_EDDIE_CHARS * 0.8;
  const exceeded = words > MAX_EDDIE_WORDS || text.length > MAX_EDDIE_CHARS;
  const hasContent = text.trim().length > 0 || mediaIds.length > 0;
  const canSubmit = hasContent && !exceeded && !isBusy && !hasError;

  const addPicked = (picked: PickedMedia[]) => {
    if (picked.length === 0) {
      return;
    }
    const result = attachmentActions.add(scope, picked, {
      max: MAX_COMMENT_ATTACHMENTS,
      purpose: "comment",
      waitForProcessing: true,
    });
    if (result.rejected) {
      toast({
        description: "Eddies take one image or GIF.",
        title: "Not allowed with this media",
        variant: "destructive",
      });
    }
  };

  const pickImage = async () => {
    try {
      addPicked(await pickPhotosAndVideos({ imagesOnly: true, remaining: 1 }));
    } catch {
      toast({
        description: "Couldn't open your photos, check app permissions?",
        title: "Photos Unavailable",
        variant: "destructive",
      });
    }
  };

  const pickGif = async (gif: KlipyGif) => {
    try {
      addPicked([await downloadGif(gif)]);
    } catch {
      toast({
        description: "Couldn't add that GIF, try another?",
        title: "GIF Failed",
        variant: "destructive",
      });
    }
  };

  const send = async (): Promise<FeedComment | null> => {
    if (!canSubmit || sending) {
      return null;
    }
    setSending(true);
    try {
      const comment = await createEddie(postId, {
        content: text.trim(),
        mediaIds,
        parentId: parentId ?? undefined,
      });
      setDraft(key, "");
      attachmentActions.clear(scope, { discard: false });
      emitEddieCreated(postId, comment);
      toast({
        description: "Your eddie is live, nice one!",
        title: "Eddie Created",
      });
      setSending(false);
      return comment;
    } catch {
      toast({
        description: "Couldn't post your eddie, give it another try?",
        title: "Eddie Failed",
        variant: "destructive",
      });
      setSending(false);
      return null;
    }
  };

  return {
    attachments,
    canSubmit,
    exceeded,
    isBusy,
    nearLimit,
    pickGif,
    pickImage,
    removeAttachment: (localId: string) => attachmentActions.remove(localId),
    retryAttachment: (localId: string) => attachmentActions.retry(localId),
    send,
    sending,
    setText: (value: string) => setDraft(key, value),
    text,
    words,
  };
}
