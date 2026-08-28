"use client";

import { clientLog } from "@asm/config/debug";
import { useCallback, useState } from "react";

import { useToast } from "@/lib/gooey-toast";
import { uploadMediaFile } from "@/lib/media-upload-client";

const MAX_COMMENT_ATTACHMENTS = 4;

export interface CommentAttachmentDraft {
  file: File;
  isUploading: boolean;
  mediaId?: string;
  objectUrl: string;
}

async function uploadCommentMedia(file: File): Promise<{ mediaId: string }> {
  const result = await uploadMediaFile(file, { purpose: "comment" });
  if (result.status === "REJECTED") {
    throw new Error("Attachment was rejected by moderation scanning");
  }
  return result;
}

export function useCommentAttachments() {
  const { toast } = useToast();
  const [attachments, setAttachments] = useState<CommentAttachmentDraft[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const startUpload = useCallback(
    async (files: File[]) => {
      if (isUploading) {
        return;
      }

      // Eddies carry images and GIFs only. Filter anything else (videos, audio,
      // documents) so a picker that bypasses the accept attribute never slips a
      // disallowed file into the thread.
      const imageFiles = files.filter(
        (file) =>
          file.type.startsWith("image/") && file.type !== "image/svg+xml"
      );

      if (imageFiles.length === 0) {
        toast({
          description: "Eddies support images and GIFs only.",
          title: "Unsupported File",
          variant: "destructive",
        });
        return;
      }

      // The limit applies to the images that actually made it through the
      // filter, not the raw selection (which may include ignored files).
      if (attachments.length + imageFiles.length > MAX_COMMENT_ATTACHMENTS) {
        toast({
          description: `An eddie can hold up to ${MAX_COMMENT_ATTACHMENTS} images or GIFs.`,
          title: "Attachment Limit",
          variant: "destructive",
        });
        return;
      }

      setIsUploading(true);
      setAttachments((prev) => [
        ...prev,
        ...imageFiles.map((file) => ({
          file,
          isUploading: true,
          objectUrl: URL.createObjectURL(file),
        })),
      ]);

      try {
        await Promise.all(
          imageFiles.map(async (file) => {
            try {
              const result = await uploadCommentMedia(file);
              setAttachments((prev) =>
                prev.map((attachment) =>
                  attachment.file === file
                    ? {
                        ...attachment,
                        isUploading: false,
                        mediaId: result.mediaId,
                      }
                    : attachment
                )
              );
            } catch (error: unknown) {
              clientLog.error("Comment attachment upload failed:", error);
              setAttachments((prev) =>
                prev.filter((attachment) => attachment.file !== file)
              );
              toast({
                description: "Couldn't upload that file, try again?",
                title: "Upload Failed",
                variant: "destructive",
              });
            }
          })
        );
      } catch (error) {
        // Reset before rethrowing so the uploading flag clears on the
        // failure path too (replaces the previous `finally` clause).
        setIsUploading(false);
        throw error;
      }
      setIsUploading(false);
    },
    [attachments.length, isUploading, toast]
  );

  const removeAttachment = useCallback((objectUrl: string) => {
    setAttachments((prev) => {
      const target = prev.find(
        (attachment) => attachment.objectUrl === objectUrl
      );
      if (target) {
        URL.revokeObjectURL(objectUrl);
      }
      return prev.filter((attachment) => attachment.objectUrl !== objectUrl);
    });
  }, []);

  const reset = useCallback(() => {
    setAttachments((prev) => {
      for (const attachment of prev) {
        URL.revokeObjectURL(attachment.objectUrl);
      }
      return [];
    });
    setIsUploading(false);
  }, []);

  return {
    attachments,
    isUploading,
    mediaIds: attachments
      .filter((attachment) => attachment.mediaId)
      .map((attachment) => attachment.mediaId as string),
    removeAttachment,
    reset,
    startUpload,
  };
}
