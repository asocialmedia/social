import { DEFAULT_LIMITS, maxBytesForType } from "@asm/media";

// Client-side direct-to-storage uploader: initiate -> presigned PUT (XHR for
// byte-level progress) -> finalize -> poll lifecycle status. Web servers never
// touch media bytes.

export type UploadStatus =
  | "UPLOADING"
  | "QUARANTINED"
  | "SCANNING"
  | "PROCESSING"
  | "READY"
  | "FAILED"
  | "REJECTED";

export interface CompletedUpload {
  mediaId: string;
  rejectedReason?: string | null;
  status: "READY" | "REJECTED";
}

export class MediaUploadError extends Error {
  override name = "MediaUploadError";
}

const TERMINAL_POLL_STATUSES = new Set(["READY", "REJECTED", "DELETED"]);

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

function categoryForMime(mime: string): "AUDIO" | "IMAGE" | "VIDEO" | null {
  const family = mime.split("/")[0]?.toLowerCase();
  if (family === "image") {
    if (mime === "image/svg+xml" || mime.startsWith("text/")) {
      return null;
    }
    return "IMAGE";
  }
  if (family === "video") {
    return "VIDEO";
  }
  if (family === "audio") {
    return "AUDIO";
  }
  return null;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

// XHR is the only browser API with upload progress events, so a Promise
// wrapper around it is required here.
// eslint-disable-next-line promise/avoid-new -- XHR needs a Promise wrapper
function putToPresignedUrl(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void
): Promise<void> {
  // XHR is the only browser API with upload progress events; a Promise
  // wrapper around it is required.
  // eslint-disable-next-line promise/avoid-new -- XHR needs a Promise wrapper
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(
          new MediaUploadError(`Storage rejected the upload (${xhr.status})`)
        );
      }
    });
    xhr.addEventListener("error", () =>
      reject(new MediaUploadError("Upload failed"))
    );
    xhr.addEventListener("abort", () =>
      reject(new MediaUploadError("Upload aborted"))
    );
    xhr.send(file);
  });
}

export async function uploadMediaFile(
  file: File,
  options: {
    purpose?: "comment" | "message" | "post";
    signal?: AbortSignal;
    onProgress?: (percent: number) => void;
  } = {}
): Promise<CompletedUpload> {
  const report =
    options.onProgress ??
    (() => {
      /* empty */
    });
  const contentType = file.type || "application/octet-stream";
  const category = categoryForMime(contentType);
  if (!category) {
    throw new MediaUploadError(`Unsupported file type: ${contentType}`);
  }
  const maxBytes = maxBytesForType(DEFAULT_LIMITS, category);
  if (file.size > maxBytes) {
    throw new MediaUploadError(
      `File exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB limit`
    );
  }

  const initiateResponse = await fetch("/api/upload/initiate", {
    body: JSON.stringify({
      name: file.name || "attachment",
      purpose: options.purpose ?? "post",
      size: file.size,
      type: contentType,
    }),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: options.signal,
  });
  if (!initiateResponse.ok) {
    throw new MediaUploadError(await parseErrorMessage(initiateResponse));
  }
  const { mediaId, uploadUrl } = (await initiateResponse.json()) as {
    mediaId: string;
    uploadUrl: string;
  };

  await putToPresignedUrl(uploadUrl, file, contentType, report);

  const finalizeResponse = await fetch("/api/upload/finalize", {
    body: JSON.stringify({ mediaId }),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: options.signal,
  });
  if (!finalizeResponse.ok) {
    throw new MediaUploadError(await parseErrorMessage(finalizeResponse));
  }

  // Poll until the pipeline reaches a terminal state.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  // oxlint-disable-next-line no-await-in-loop -- sequential status polling
  for (;;) {
    if (Date.now() > deadline) {
      // Processing is still running server-side; surface as failure to the
      // composer while the pipeline continues independently.
      throw new MediaUploadError("Still processing - check back in a moment");
    }
    // oxlint-disable-next-line no-await-in-loop -- sequential status polling
    await Bun.sleep(POLL_INTERVAL_MS);
    if (options.signal?.aborted) {
      throw new MediaUploadError("Upload aborted");
    }
    // oxlint-disable-next-line no-await-in-loop -- sequential polling
    const poll = await fetch(`/api/media/${mediaId}/status`, {
      credentials: "same-origin",
    });
    if (!poll.ok) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- sequential polling
    const state = (await poll.json()) as {
      rejectedReason?: string | null;
      status: UploadStatus;
    };
    if (TERMINAL_POLL_STATUSES.has(state.status)) {
      if (state.status === "READY") {
        return { mediaId, status: "READY" };
      }
      return {
        mediaId,
        rejectedReason: state.rejectedReason,
        status: "REJECTED",
      };
    }
  }
}
