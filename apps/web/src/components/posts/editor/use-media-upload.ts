import { Upload } from "lucide-react";
import { createElement, useState } from "react";
import { useToast } from "@/lib/gooey-toast";
import { validateFile } from "@/lib/utils/file-validation";

export interface Attachment {
  file: File;
  isUploading: boolean;
  mediaId?: string;
}

export default function useMediaUpload() {
  const { toast } = useToast();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>();

  async function uploadMedia(file: File) {
    try {
      validateFile(file);

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const { mediaId, url } = await response.json();
      return { mediaId, url };
    } catch (error: unknown) {
      throw new Error(
        error instanceof Error ? error.message : "Upload failed",
        {
          cause: error,
        }
      );
    }
  }

  async function handleStartUpload(files: File[]) {
    if (isUploading) {
      toast({
        title: "Upload in Progress",
        description: "One upload at a time, hang tight!",
        icon: createElement(Upload),
      });
      return;
    }

    if (attachments.length + files.length > 5) {
      toast({
        variant: "destructive",
        title: "Attachment Limit",
        description: "A post can hold up to 5 attachments.",
      });
      return;
    }

    setIsUploading(true);
    setAttachments((prev) => [
      ...prev,
      ...files.map((file) => ({ file, isUploading: true })),
    ]);

    try {
      let completed = 0;
      await Promise.all(
        files.map(async (file) => {
          try {
            const result = await uploadMedia(file);
            setAttachments((prev) =>
              prev.map((a) =>
                a.file === file
                  ? { ...a, mediaId: result.mediaId, isUploading: false }
                  : a
              )
            );
            completed += 1;
            setUploadProgress((completed / files.length) * 100);
          } catch (error: unknown) {
            console.error("Upload failed:", error);
            toast({
              variant: "destructive",
              title: "Upload Failed",
              description: "Couldn't upload that file, try again?",
            });
            setAttachments((prev) => prev.filter((a) => a.file !== file));
          }
        })
      );
    } finally {
      setIsUploading(false);
      setUploadProgress(undefined);
    }
  }

  function removeAttachment(fileName: string) {
    setAttachments((prev) => prev.filter((a) => a.file.name !== fileName));
  }

  function reset() {
    setAttachments([]);
    setUploadProgress(undefined);
  }

  return {
    startUpload: handleStartUpload,
    attachments,
    isUploading,
    uploadProgress,
    removeAttachment,
    reset,
  };
}
