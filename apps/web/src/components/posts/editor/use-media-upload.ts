import { clientLog } from "@asm/config/debug";
import { Upload } from "lucide-react";
import { createElement, useMemo, useState } from "react";

import { useToast } from "@/lib/gooey-toast";
import { validateFile } from "@/lib/utils/file-validation";

export interface Attachment {
  file: File;
  isUploading: boolean;
  mediaId?: string;
  progress: number;
}

// Uploads a single file via XHR so the caller receives real byte-level
// progress (fetch has no upload progress API). Returns the media row and a
// percentage that updates as the request body streams to the server.
function uploadMedia(file: File, onProgress: (percent: number) => void) {
  // oxlint-disable-next-line promise/avoid-new -- XHR needs a Promise wrapper
  return new Promise<{ mediaId: string; url: string }>((resolve, reject) => {
    try {
      validateFile(file);
    } catch (error: unknown) {
      reject(error instanceof Error ? error : new Error("Upload failed"));
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const { mediaId, url } = JSON.parse(xhr.responseText) as {
            mediaId: string;
            url: string;
          };
          onProgress(100);
          resolve({ mediaId, url });
        } catch (error: unknown) {
          reject(error instanceof Error ? error : new Error("Bad response"));
        }
      } else {
        reject(new Error("Upload failed"));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Upload failed")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
    xhr.send(formData);
  });
}

export default function useMediaUpload() {
  const { toast } = useToast();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const uploadProgress = useMemo(() => {
    const uploading = attachments.filter((a) => a.isUploading);
    if (uploading.length === 0) {
      return;
    }
    return Math.round(
      uploading.reduce((sum, a) => sum + a.progress, 0) / uploading.length
    );
  }, [attachments]);

  async function handleStartUpload(files: File[]) {
    if (isUploading) {
      toast({
        description: "One upload at a time, hang tight!",
        icon: createElement(Upload),
        title: "Upload in Progress",
      });
      return;
    }

    if (attachments.length + files.length > 5) {
      toast({
        description: "A post can hold up to 5 attachments.",
        title: "Attachment Limit",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    setAttachments((prev) => [
      ...prev,
      ...files.map((file) => ({ file, isUploading: true, progress: 0 })),
    ]);

    try {
      await Promise.all(
        files.map(async (file) => {
          try {
            const result = await uploadMedia(file, (percent) => {
              setAttachments((prev) =>
                prev.map((a) =>
                  a.file === file ? { ...a, progress: percent } : a
                )
              );
            });
            setAttachments((prev) =>
              prev.map((a) =>
                a.file === file
                  ? { ...a, isUploading: false, mediaId: result.mediaId }
                  : a
              )
            );
          } catch (error: unknown) {
            clientLog.error("Upload failed:", error);
            toast({
              description: "Couldn't upload that file, try again?",
              title: "Upload Failed",
              variant: "destructive",
            });
            setAttachments((prev) => prev.filter((a) => a.file !== file));
          }
        })
      );
    } finally {
      setIsUploading(false);
    }
  }

  function removeAttachment(fileName: string) {
    setAttachments((prev) => prev.filter((a) => a.file.name !== fileName));
  }

  function reset() {
    setAttachments([]);
  }

  return {
    attachments,
    isUploading,
    removeAttachment,
    reset,
    startUpload: handleStartUpload,
    uploadProgress,
  };
}
