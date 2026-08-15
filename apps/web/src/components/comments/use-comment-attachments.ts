"use client";

import { clientLog } from "@asm/config/debug";
import { useCallback, useState } from "react";

import { useToast } from "@/lib/gooey-toast";

const MAX_COMMENT_ATTACHMENTS = 4;

export interface CommentAttachmentDraft {
  file: File;
  isUploading: boolean;
  mediaId?: string;
  objectUrl: string;
}

function uploadCommentMedia(
  file: File
): Promise<{ mediaId: string; url: string }> {
  const formData = new FormData();
  formData.append("file", file);

  return fetch("/api/upload", {
    body: formData,
    method: "POST",
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error("Upload failed");
    }
    return (await response.json()) as { mediaId: string; url: string };
  });
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

      if (attachments.length + files.length > MAX_COMMENT_ATTACHMENTS) {
        toast({
          description: `An eddy can hold up to ${MAX_COMMENT_ATTACHMENTS} images or GIFs.`,
          title: "Attachment Limit",
          variant: "destructive",
        });
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
      } finally {
        setIsUploading(false);
      }
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
