// Native port of web's uploadMediaFile + watchMediaStatus
// (apps/web/src/lib/media/media-upload-client.ts):
//
//   initiate -> bytes (single PUT, or multipart: 3 workers, per-part retry,
//   complete) -> finalize (retried) -> optional status polling.
//
// Fault tolerance: every step retries transient failures (network, 408, 429
// honoring retry-after, 5xx) with jittered backoff; `/api/upload*` calls are
// spaced under the server's per-IP budget; everything is abortable. Failures
// carry the stage they died in and the media id, so a retry resumes where it
// stopped (re-finalize or keep polling) instead of re-sending the bytes.
// Every step logs through telemetry (no file names, no URLs).
import { logError, logInfo, logWarn } from "@/lib/telemetry";

import { AbortError, HttpError, isAbortError, sleep, withRetry } from "./retry";
import {
  completeMultipart,
  fetchMediaStatus,
  finalizeUpload,
  initiateUpload,
  presignPart,
} from "./upload-api";
import type { UploadPurpose } from "./upload-api";
import { assertUploadable, planParts } from "./upload-policy";
import type { MediaFamily } from "./upload-policy";
import {
  isTerminalStatus,
  rejectionCopy,
  stageForStatus,
} from "./upload-status";
import type { ServerMediaStatus, UploadStage } from "./upload-status";
import { putFilePart, putWholeFile } from "./upload-transport";

export interface UploadSource {
  height?: number;
  mimeType: string;
  name: string;
  size: number;
  uri: string;
  width?: number;
}

export type FailedStep = "finalize" | "initiate" | "processing" | "upload";

export class UploadError extends Error {
  readonly mediaId: string | null;
  readonly step: FailedStep;
  readonly userMessage: string;
  constructor(
    step: FailedStep,
    userMessage: string,
    mediaId: string | null,
    cause?: unknown
  ) {
    super(userMessage);
    this.name = "UploadError";
    this.step = step;
    this.userMessage = userMessage;
    this.mediaId = mediaId;
    this.cause = cause;
  }
}

export interface UploadCallbacks {
  // 0-100 of the byte transfer.
  onBytes?: (percent: number) => void;
  // Fired as soon as the server assigns an id, so a cancel can discard it.
  onMediaId?: (mediaId: string) => void;
  onStage?: (stage: UploadStage) => void;
}

export interface UploadOptions extends UploadCallbacks {
  purpose: UploadPurpose;
  signal?: AbortSignal;
  // Posts attach before READY (web's waitForProcessing:false); comments wait.
  waitForProcessing: boolean;
}

export interface UploadOutcome {
  family: MediaFamily;
  mediaId: string;
  status: ServerMediaStatus | "DETACHED";
}

const PART_CONCURRENCY = 3;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

function friendlyMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403) {
      return "Session expired - sign in and re-upload";
    }
    if (error.status === 429) {
      return "Slow down a little - uploads are rate limited";
    }
    if (error.status < 500 && error.message) {
      return error.message;
    }
    return "The server had a hiccup";
  }
  if (error instanceof Error && error.message.includes("Network")) {
    return "Connection lost";
  }
  return fallback;
}

function retryLogger(step: string, family: MediaFamily) {
  return (error: unknown, attempt: number, delayMs: number) => {
    logWarn("upload.retry", {
      attempt,
      delayMs,
      family,
      status: error instanceof HttpError ? error.status : 0,
      step,
    });
  };
}

async function uploadMultipart(options: {
  family: MediaFamily;
  mediaId: string;
  onBytes?: (percent: number) => void;
  partSize: number;
  signal?: AbortSignal;
  source: UploadSource;
  uploadId: string;
}): Promise<void> {
  const { family, mediaId, source, uploadId } = options;
  const parts = planParts(source.size, options.partSize);
  const sent = new Map<number, number>();
  const eTags = new Map<number, string>();
  const report = () => {
    let total = 0;
    for (const bytes of sent.values()) {
      total += bytes;
    }
    options.onBytes?.(Math.min(100, (total / source.size) * 100));
  };

  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const part = parts[cursor];
      cursor += 1;
      if (!part) {
        return;
      }
      // eslint-disable-next-line no-await-in-loop -- each worker uploads its parts one after another; parallelism comes from PART_CONCURRENCY workers
      const eTag = await withRetry(
        async () => {
          sent.set(part.partNumber, 0);
          const { uploadUrl } = await presignPart(
            { mediaId, partNumber: part.partNumber, uploadId },
            options.signal
          );
          return await putFilePart({
            end: part.end,
            onProgress: (bytes) => {
              sent.set(part.partNumber, bytes);
              report();
            },
            signal: options.signal,
            start: part.start,
            uri: source.uri,
            url: uploadUrl,
          });
        },
        {
          attempts: 3,
          onRetry: retryLogger("part", family),
          signal: options.signal,
        }
      );
      sent.set(part.partNumber, part.end - part.start);
      eTags.set(part.partNumber, eTag);
      report();
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PART_CONCURRENCY, parts.length) }, worker)
  );

  await withRetry(
    () =>
      completeMultipart(
        {
          mediaId,
          parts: parts.map((part) => ({
            eTag: eTags.get(part.partNumber) ?? "",
            partNumber: part.partNumber,
          })),
          uploadId,
        },
        options.signal
      ),
    {
      attempts: 4,
      baseMs: 1500,
      onRetry: retryLogger("complete", family),
      signal: options.signal,
    }
  );
}

// Polls until a terminal status. Transient poll failures keep polling; an
// auth failure stops with the session copy; the 5-minute cap returns
// DETACHED (the media keeps processing server-side).
export async function watchMediaStatus(
  mediaId: string,
  options: {
    onStage?: (stage: UploadStage) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<ServerMediaStatus | "DETACHED"> {
  const deadline = Date.now() + (options.timeoutMs ?? POLL_TIMEOUT_MS);
  let failures = 0;
  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-await-in-loop -- polling is sequential by definition
      const status = await fetchMediaStatus(mediaId, options.signal);
      failures = 0;
      if (isTerminalStatus(status.status)) {
        if (status.status !== "READY") {
          throw new UploadError(
            "processing",
            rejectionCopy(status.rejectedReason ?? status.failureCode),
            mediaId
          );
        }
        options.onStage?.("ready");
        return status.status;
      }
      options.onStage?.(stageForStatus(status.status));
    } catch (error) {
      if (error instanceof UploadError || isAbortError(error)) {
        throw error;
      }
      if (
        error instanceof HttpError &&
        (error.status === 401 || error.status === 403)
      ) {
        throw new UploadError(
          "processing",
          "Session expired - sign in and re-upload",
          mediaId,
          error
        );
      }
      failures += 1;
      if (failures === 1 || failures % 10 === 0) {
        logWarn("upload.poll_failed", {
          failures,
          status: error instanceof HttpError ? error.status : 0,
        });
      }
    }
    // eslint-disable-next-line no-await-in-loop -- the poll interval must elapse between checks
    await sleep(POLL_INTERVAL_MS, options.signal);
  }
  return "DETACHED";
}

export async function finishFromFinalize(
  mediaId: string,
  family: MediaFamily,
  options: Pick<UploadOptions, "onStage" | "signal" | "waitForProcessing">
): Promise<UploadOutcome> {
  let finalized: { status: ServerMediaStatus };
  try {
    finalized = await withRetry(() => finalizeUpload(mediaId, options.signal), {
      attempts: 4,
      baseMs: 1500,
      onRetry: retryLogger("finalize", family),
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new UploadError(
      "finalize",
      friendlyMessage(error, "Couldn't finish the upload"),
      mediaId,
      error
    );
  }
  options.onStage?.(stageForStatus(finalized.status));
  if (!options.waitForProcessing) {
    return { family, mediaId, status: finalized.status };
  }
  const status = await watchMediaStatus(mediaId, options);
  return { family, mediaId, status };
}

export async function uploadMedia(
  source: UploadSource,
  options: UploadOptions
): Promise<UploadOutcome> {
  const startedAt = Date.now();
  let family: MediaFamily;
  try {
    family = assertUploadable(source.mimeType, source.size);
  } catch (error) {
    throw new UploadError(
      "initiate",
      error instanceof Error ? error.message : "This file can't be uploaded",
      null,
      error
    );
  }
  const multipart = source.size > 64 * 1024 * 1024;
  logInfo("upload.start", {
    family,
    multipart,
    purpose: options.purpose,
    sizeKb: Math.round(source.size / 1024),
  });

  let mediaId: string | null = null;
  try {
    const initiated = await withRetry(
      () =>
        initiateUpload(
          {
            height: source.height,
            name: source.name,
            purpose: options.purpose,
            size: source.size,
            type: source.mimeType,
            width: source.width,
          },
          options.signal
        ),
      {
        attempts: 4,
        onRetry: retryLogger("initiate", family),
        signal: options.signal,
      }
    ).catch((error: unknown) => {
      if (isAbortError(error)) {
        throw error;
      }
      throw new UploadError(
        "initiate",
        friendlyMessage(error, "Couldn't start the upload"),
        null,
        error
      );
    });
    ({ mediaId } = initiated);
    options.onMediaId?.(initiated.mediaId);

    // Dedup hit: the bytes already exist server-side.
    if (initiated.uploadUrl === null && !initiated.multipartUpload) {
      options.onBytes?.(100);
      if (initiated.status === "READY" || !options.waitForProcessing) {
        options.onStage?.(stageForStatus(initiated.status));
        return { family, mediaId: initiated.mediaId, status: initiated.status };
      }
      const status = await watchMediaStatus(initiated.mediaId, options);
      return { family, mediaId: initiated.mediaId, status };
    }

    options.onStage?.("uploading");
    try {
      if (initiated.multipartUpload) {
        await uploadMultipart({
          family,
          mediaId: initiated.mediaId,
          onBytes: options.onBytes,
          partSize: initiated.multipartUpload.partSize,
          signal: options.signal,
          source,
          uploadId: initiated.multipartUpload.uploadId,
        });
      } else if (initiated.uploadUrl) {
        const url = initiated.uploadUrl;
        await withRetry(
          () =>
            putWholeFile({
              contentType: source.mimeType,
              onProgress: (bytes) =>
                options.onBytes?.(Math.min(100, (bytes / source.size) * 100)),
              signal: options.signal,
              uri: source.uri,
              url,
            }),
          {
            attempts: 3,
            onRetry: retryLogger("put", family),
            signal: options.signal,
          }
        );
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      throw new UploadError(
        "upload",
        friendlyMessage(error, "Upload failed"),
        initiated.mediaId,
        error
      );
    }
    options.onBytes?.(100);

    const outcome = await finishFromFinalize(
      initiated.mediaId,
      family,
      options
    );
    logInfo("upload.done", {
      family,
      ms: Date.now() - startedAt,
      multipart,
      status: outcome.status,
    });
    return outcome;
  } catch (error) {
    if (isAbortError(error)) {
      logInfo("upload.cancelled", { family });
      throw new AbortError();
    }
    const failure =
      error instanceof UploadError
        ? error
        : new UploadError(
            "upload",
            friendlyMessage(error, "Upload failed"),
            mediaId,
            error
          );
    logError("upload.failed", failure.cause ?? failure, {
      family,
      step: failure.step,
    });
    throw failure;
  }
}
