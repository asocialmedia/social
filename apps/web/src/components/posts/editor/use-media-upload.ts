import { clientLog } from "@asm/config/debug";
import { Upload } from "lucide-react";
import { createElement, useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/lib/gooey-toast";
import { validateFile } from "@/lib/utils/file-validation";

// A completed upload is persisted to sessionStorage so a refresh or a quick
// navigation (e.g. scrolling the gusts feed) doesn't wipe the composer draft.
// Only the server media row + display metadata are stored - never the File
// object (it is not serializable).
const STORAGE_KEY = "asm-composer-attachments";
const STORAGE_VERSION = 1;

export interface Attachment {
  file?: File;
  isUploading: boolean;
  mediaId?: string;
  mediaUrl?: string;
  name?: string;
  progress: number;
  type?: string;
}

interface StoredAttachment {
  mediaId: string;
  mediaUrl: string;
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
      mediaUrl: item.mediaUrl,
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
    .filter((attachment) => attachment.mediaId && attachment.mediaUrl)
    .map((attachment) => ({
      mediaId: attachment.mediaId as string,
      mediaUrl: attachment.mediaUrl as string,
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
  // Start empty so the server-rendered HTML matches the first client render;
  // the saved draft is restored in an effect after hydration instead of in the
  // state initializer (sessionStorage is client-only, and reading it during
  // the initial render caused a hydration mismatch once images were persisted).
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const initialisedRef = useRef(false);

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
                prev.map((attachment) =>
                  attachment.file === file
                    ? { ...attachment, progress: percent }
                    : attachment
                )
              );
            });
            setAttachments((prev) =>
              prev.map((attachment) =>
                attachment.file === file
                  ? {
                      ...attachment,
                      isUploading: false,
                      mediaId: result.mediaId,
                      mediaUrl: result.url,
                    }
                  : attachment
              )
            );
          } catch (error: unknown) {
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
        })
      );
    } finally {
      setIsUploading(false);
    }
  }

  const removeAttachment = useCallback((fileName: string) => {
    setAttachments((prev) => {
      const next = prev.filter((a) => (a.file?.name ?? a.name) !== fileName);
      persistAttachments(next);
      return next;
    });
  }, []);

  function reset() {
    setAttachments([]);
    clearStoredAttachments();
  }

  return {
    attachments,
    isUploading,
    removeAttachment,
    reset,
    startUpload: handleStartUpload,
  };
}
