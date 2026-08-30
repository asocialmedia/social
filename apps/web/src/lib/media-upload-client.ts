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

// User-facing pipeline phases surfaced in the composer progress UI. Derived
// from real poll statuses - never simulated.
export type UploadStage = "uploading" | "queued" | "scanning" | "processing";

export interface CompletedUpload {
  mediaId: string;
  rejectedReason?: string | null;
  status: "READY" | "REJECTED";
}

export class MediaUploadError extends Error {
  override name = "MediaUploadError";
}

// Mirrors the zod cap enforced server-side by PATCH /api/media/[mediaId]/alt.
export const ALT_TEXT_MAX_LENGTH = 1000;

// Persists owner-authored alt text on an uploaded media row. Safe to call
// fire-and-forget: resolves false on any failure so callers keep their local
// state instead of throwing into the upload flow. An empty string clears the
// stored value (the route maps "" to null).
export async function patchAltText(
  mediaId: string,
  altText: string
): Promise<boolean> {
  try {
    const response = await fetch(`/api/media/${mediaId}/alt`, {
      body: JSON.stringify({ altText }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Attaches (or clears with null) a custom cover image for a video (gust
// thumbnail). The server copies the image's published bytes into the video's
// key space; the thumbnail serving route prefers them over the generated
// poster.
export async function patchThumbnail(
  mediaId: string,
  thumbnailMediaId: string | null
): Promise<boolean> {
  try {
    const response = await fetch(`/api/media/${mediaId}/thumbnail`, {
      body: JSON.stringify({ thumbnailMediaId }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    return response.ok;
  } catch {
    return false;
  }
}

const TERMINAL_POLL_STATUSES = new Set(["READY", "REJECTED", "DELETED"]);

// Attaches (or clears with null) a gust sound on an already-created video
// row. The overlay normally rides along at upload initiate; this covers the
// sound-picked-after-video flow.
export async function patchAudioOverlay(
  mediaId: string,
  audioOverlayId: string | null
): Promise<boolean> {
  try {
    const response = await fetch(`/api/media/${mediaId}/audio-overlay`, {
      body: JSON.stringify({ audioOverlayId }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    return response.ok;
  } catch {
    return false;
  }
}

// User-facing copy for pipeline rejection reasons. TOO_LARGE covers both the
// per-family byte caps and the antivirus scanner's INSTREAM limit, which the
// scan stage maps to the same RejectionReason.
export function rejectionCopy(reason?: string | null): string {
  switch (reason) {
    case "MALWARE": {
      return "Security scan found a threat in this file.";
    }
    case "MIME_MISMATCH": {
      return "The file's contents don't match its type.";
    }
    case "TOO_LARGE": {
      return "This file is too large to process.";
    }
    case "TOO_LONG": {
      return "This file is longer than allowed.";
    }
    case "CORRUPT": {
      return "The file appears to be corrupted.";
    }
    case "UNSUPPORTED_TYPE": {
      return "This file type isn't supported.";
    }
    case "POLICY": {
      return "This file violates the content policy.";
    }
    default: {
      return "This attachment was rejected.";
    }
  }
}

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

/**
 * Computes SHA-256 digest of a File using Web Crypto API.
 * Returns null when Web Crypto is unavailable or file read fails.
 */
export async function computeFileSha256(file: File): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return null;
  }
  try {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (const byte of bytes) {
      hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
  } catch {
    return null;
  }
}

function uploadStatusToStage(status: UploadStatus): UploadStage {
  if (status === "SCANNING") {
    return "scanning";
  }
  if (status === "PROCESSING") {
    return "processing";
  }
  return "queued";
}

export async function uploadMediaFile(
  file: File,
  options: {
    /** Media id of an AUDIO upload whose track replaces the video's own
     * audio during pipeline processing (gust "sound"). */
    audioOverlayId?: string | null;
    purpose?: "avatar" | "banner" | "comment" | "message" | "post";
    signal?: AbortSignal;
    onProgress?: (percent: number) => void;
    onStage?: (stage: UploadStage) => void;
  } = {}
): Promise<CompletedUpload> {
  const report =
    options.onProgress ??
    (() => {
      /* empty */
    });
  const reportStage =
    options.onStage ??
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

  // Pre-compute content hash to check for server-side deduplication / reuse.
  // file.arrayBuffer() materializes the whole upload in memory, so on large
  // videos (the dominant bandwidth cost of hashing) dedup is skipped: a
  // fresh upload pipeline run costs far less than buffering a 2GB file in a
  // browser tab. Smaller files always hash and keep instant reuse.
  const DEDUP_HASH_MAX_BYTES = 256 * 1024 * 1024;
  const sha256 =
    file.size <= DEDUP_HASH_MAX_BYTES ? await computeFileSha256(file) : null;

  const initiateResponse = await fetch("/api/upload/initiate", {
    body: JSON.stringify({
      audioOverlayId: options.audioOverlayId ?? undefined,
      name: file.name || "attachment",
      purpose: options.purpose ?? "post",
      sha256: sha256 ?? undefined,
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
  const {
    mediaId,
    status: initialStatus,
    uploadUrl,
  } = (await initiateResponse.json()) as {
    mediaId: string;
    status: UploadStatus;
    uploadUrl: string | null;
  };

  // Instant deduplication cache hit: existing media is already processed & READY
  if (initialStatus === "READY" && !uploadUrl) {
    report(100);
    return { mediaId, status: "READY" };
  }

  // Deduplication hit on an in-flight processing job: skip byte upload and join watcher
  if (
    !uploadUrl &&
    (initialStatus === "SCANNING" ||
      initialStatus === "PROCESSING" ||
      initialStatus === "QUARANTINED")
  ) {
    report(100);
    reportStage(uploadStatusToStage(initialStatus));
    const outcome = await watchMediaStatus(mediaId, {
      onStage: reportStage,
      signal: options.signal,
    });
    if (outcome.status === "READY") {
      return { mediaId, status: "READY" };
    }
    if (outcome.status === "DETACHED") {
      throw new MediaUploadError("Still processing - check back in a moment");
    }
    return {
      mediaId,
      rejectedReason: outcome.rejectedReason,
      status: "REJECTED",
    };
  }

  if (!uploadUrl) {
    throw new MediaUploadError("Upload URL was not provided");
  }

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
  // Bytes are in quarantine; the pipeline owns the file from here.
  reportStage("queued");

  // Poll until the pipeline reaches a terminal state.
  const outcome = await watchMediaStatus(mediaId, {
    onStage: reportStage,
    signal: options.signal,
  });
  if (outcome.status === "READY") {
    return { mediaId, status: "READY" };
  }
  if (outcome.status === "DETACHED") {
    // Processing is still running server-side; surface as failure to the
    // composer while the pipeline continues independently.
    throw new MediaUploadError("Still processing - check back in a moment");
  }
  return {
    mediaId,
    rejectedReason: outcome.rejectedReason,
    status: "REJECTED",
  };
}

// Outcome of watching an in-flight pipeline row. `detached` means the watch
// gave up (deadline/auth) while the server keeps working - callers decide
// whether that is fatal or resumable.
export type StatusWatchOutcome =
  | { rejectedReason?: string | null; status: "REJECTED" }
  | { status: "READY" }
  | { reason: string; status: "DETACHED" };

/**
 * Drives stage callbacks from real /status polls until the row reaches a
 * terminal state. Used both right after finalize and to RE-ATTACH to items
 * whose composer unmounted mid-pipeline (draft restore).
 */
export async function watchMediaStatus(
  mediaId: string,
  options: {
    onStage?: (stage: UploadStage) => void;
    signal?: AbortSignal;
  } = {}
): Promise<StatusWatchOutcome> {
  const reportStage =
    options.onStage ??
    (() => {
      /* empty */
    });
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  // oxlint-disable-next-line no-await-in-loop -- sequential status polling
  for (;;) {
    if (Date.now() > deadline) {
      // Processing continues server-side regardless; surface as detached so
      // restored drafts can re-watch later instead of dying with an error.
      return { reason: "watch deadline exceeded", status: "DETACHED" };
    }
    // eslint-disable-next-line no-await-in-loop, no-promise-executor-return, promise/avoid-new -- sequential polling with sleep
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    if (options.signal?.aborted) {
      return { reason: "aborted", status: "DETACHED" };
    }
    // oxlint-disable-next-line no-await-in-loop -- sequential polling
    const poll = await fetch(`/api/media/${mediaId}/status`, {
      credentials: "same-origin",
    });
    if (!poll.ok) {
      // Auth failures never heal by retrying - bail out immediately instead
      // of spinning until the deadline on every attachment.
      if (poll.status === 401 || poll.status === 403) {
        throw new MediaUploadError("Session expired - sign in and re-upload");
      }
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- sequential polling
    const state = (await poll.json()) as {
      rejectedReason?: string | null;
      status: UploadStatus;
    };
    // Real pipeline stages drive the composer's progress UI - each status
    // maps to a user-visible phase, nothing here is simulated.
    if (state.status === "QUARANTINED") {
      reportStage("queued");
    } else if (state.status === "SCANNING") {
      reportStage("scanning");
    } else if (state.status === "PROCESSING") {
      reportStage("processing");
    }
    if (TERMINAL_POLL_STATUSES.has(state.status)) {
      if (state.status === "READY") {
        return { status: "READY" };
      }
      return {
        rejectedReason: state.rejectedReason,
        status: "REJECTED",
      };
    }
  }
}
