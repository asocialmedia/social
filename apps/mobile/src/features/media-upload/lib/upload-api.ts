// JSON calls to web's media pipeline routes (apps/web/src/app/api/upload/*,
// app/api/media/[mediaId]/*). Every request rides the stored session cookie;
// the global install-token interceptor (lib/install-fetch) adds x-asm-install
// to these same-origin mutations, which the edge proxy requires. The
// `/api/upload*` calls go through the client rate budget first.
//
// Errors surface as HttpError (status, server `error` copy, retry-after) so
// the retry policy and the UI can tell a rate limit from a rejection.
import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";

import { uploadRateBudget } from "./rate-budget";
import { AbortError, HttpError, parseRetryAfter } from "./retry";
import type { ServerMediaStatus } from "./upload-status";

export type UploadPurpose = "comment" | "post";

export interface InitiateRequest {
  height?: number;
  name: string;
  purpose: UploadPurpose;
  size: number;
  type: string;
  width?: number;
}

export interface InitiateResponse {
  deduplicated: boolean;
  mediaId: string;
  multipartUpload: { partSize: number; uploadId: string } | null;
  status: ServerMediaStatus;
  uploadUrl: string | null;
}

export interface MediaStatusResponse {
  altText: string | null;
  explicit?: boolean;
  failureCode?: string | null;
  mediaId: string;
  rejectedReason?: string | null;
  status: ServerMediaStatus;
}

function readError(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const { error } = body as { error?: unknown };
    if (typeof error === "string" && error) {
      return error;
    }
  }
  return fallback;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function apiJson<T>(
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: "DELETE" | "GET" | "PATCH" | "POST";
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  if (options.signal?.aborted) {
    throw new AbortError();
  }
  if (path.startsWith("/api/upload")) {
    await uploadRateBudget.acquire();
  }
  const headers: Record<string, string> = { ...options.headers };
  const cookie = await authClient.getCookie();
  if (cookie) {
    headers.cookie = cookie;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: options.method ?? "GET",
    signal: options.signal,
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new HttpError(
      readError(body, `Request failed (${response.status})`),
      response.status,
      body,
      parseRetryAfter(response.headers.get("retry-after"))
    );
  }
  return body as T;
}

export function initiateUpload(
  request: InitiateRequest,
  signal?: AbortSignal
): Promise<InitiateResponse> {
  return apiJson<InitiateResponse>("/api/upload/initiate", {
    body: request,
    method: "POST",
    signal,
  });
}

export function presignPart(
  input: { mediaId: string; partNumber: number; uploadId: string },
  signal?: AbortSignal
): Promise<{ uploadUrl: string }> {
  return apiJson<{ uploadUrl: string }>("/api/upload/part", {
    body: input,
    method: "POST",
    signal,
  });
}

export function completeMultipart(
  input: {
    mediaId: string;
    parts: { eTag: string; partNumber: number }[];
    uploadId: string;
  },
  signal?: AbortSignal
): Promise<{ mediaId: string }> {
  return apiJson<{ mediaId: string }>("/api/upload/complete", {
    body: input,
    method: "POST",
    signal,
  });
}

export function finalizeUpload(
  mediaId: string,
  signal?: AbortSignal
): Promise<{ mediaId: string; status: ServerMediaStatus }> {
  return apiJson<{ mediaId: string; status: ServerMediaStatus }>(
    "/api/upload/finalize",
    { body: { mediaId }, method: "POST", signal }
  );
}

export function fetchMediaStatus(
  mediaId: string,
  signal?: AbortSignal
): Promise<MediaStatusResponse> {
  return apiJson<MediaStatusResponse>(
    `/api/media/${encodeURIComponent(mediaId)}/status`,
    { signal }
  );
}

// Best-effort: an attached or foreign media answers 409, which is fine.
export async function discardDraftMedia(mediaId: string): Promise<void> {
  try {
    await apiJson(`/api/media/${encodeURIComponent(mediaId)}/draft-discard`, {
      method: "DELETE",
    });
  } catch {
    // The server's orphan sweep reclaims anything a failed discard leaves.
  }
}

export function saveAltText(
  mediaId: string,
  altText: string
): Promise<unknown> {
  return apiJson(`/api/media/${encodeURIComponent(mediaId)}/alt`, {
    body: { altText },
    method: "PATCH",
  });
}

export function suggestAltText(
  mediaId: string
): Promise<{ isProcessing?: boolean; suggestedAlt?: string }> {
  return apiJson<{ isProcessing?: boolean; suggestedAlt?: string }>(
    `/api/media/${encodeURIComponent(mediaId)}/alt`
  );
}
