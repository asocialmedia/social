// Native counterpart of web's `avatar-mutations.ts`. The pipeline is identical
// on both platforms: upload the bytes with purpose "avatar"/"banner" (presigned
// PUT -> quarantine -> scan -> publish), wait for a READY row, then link that
// row through POST /api/users/avatar or /api/users/banner. Linking only accepts
// READY rows server-side, so a scan failure can never end up on a profile.
//
// Every mutation is wrapped in the install credential, which the web gets for
// free from its origin-bearing fetch and native has to request explicitly.
import { authClient } from "@/features/auth/lib/auth-client";
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import type { UploadPurpose } from "@/features/media-upload/lib/upload-api";
import type { UploadSource } from "@/features/media-upload/lib/upload-client";
import { uploadMedia } from "@/features/media-upload/lib/upload-client";
import { getApiBaseUrl } from "@/lib/api-env";
import { logInfo, logWarn } from "@/lib/telemetry";

import { pickProfileImage } from "./profile-media";
import type { ProfileImageKind } from "./profile-media";

export interface ProfileMediaCallbacks {
  onBytes?: (percent: number) => void;
  onStage?: (stage: string) => void;
}

export type ProfileMediaResult =
  | { kind: "cancelled" }
  | { kind: "error"; message: string }
  | { kind: "install-token-required" }
  | { kind: "success"; url: string | null };

// Web's rejection copy, kept identical so a user who hits the same wall on
// either platform reads the same thing.
function rejectionMessage(rejectedReason: string | null | undefined): string {
  return rejectedReason === "MALWARE"
    ? "That file failed the security scan"
    : "That file was rejected";
}

function linkPath(kind: ProfileImageKind): string {
  return kind === "avatar" ? "/api/users/avatar" : "/api/users/banner";
}

async function linkMedia(
  kind: ProfileImageKind,
  mediaId: string,
  options: ApiCallOptions
): Promise<
  | { ok: true; url: string | null }
  | { ok: false; message: string; retryable: boolean }
> {
  const response = await (options.baseFetch ?? fetch)(
    `${options.apiBase}${linkPath(kind)}`,
    {
      body: JSON.stringify({ mediaId }),
      headers: {
        "Content-Type": "application/json",
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
      method: "POST",
    }
  );
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  if (response.ok) {
    const url =
      typeof body === "object" && body !== null
        ? (body as { avatarUrl?: unknown; bannerUrl?: unknown })
        : null;
    return {
      ok: true,
      url:
        kind === "avatar"
          ? ((url?.avatarUrl as string | undefined) ?? null)
          : ((url?.bannerUrl as string | undefined) ?? null),
    };
  }
  if (
    response.status === 403 &&
    typeof body === "object" &&
    body !== null &&
    (body as { error?: unknown }).error === "install-token-required"
  ) {
    return {
      message: "install-token-required",
      ok: false,
      retryable: true,
    };
  }
  return {
    message: typeof body === "string" && body ? body : "That didn't work",
    ok: false,
    retryable: false,
  };
}

/**
 * Picks, crops, uploads and links one profile image. `runWithInstallToken`
 * re-runs `attempt` after the Turnstile gate, so the pick is deliberately kept
 * outside it: re-opening a picker on retry would be jarring, and the picked
 * file is already on disk by then.
 */
export async function updateProfileMedia(
  kind: ProfileImageKind,
  callbacks: ProfileMediaCallbacks,
  runWithInstallToken: <T>(
    action: () => Promise<T>,
    isTokenRejected: (result: T) => boolean
  ) => Promise<T | null>
): Promise<ProfileMediaResult> {
  let picked: Awaited<ReturnType<typeof pickProfileImage>>;
  try {
    picked = await pickProfileImage(kind);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Couldn't process that image";
    logWarn("profile.media_pick_failed", {
      kind,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return { kind: "error", message };
  }
  if (!picked) {
    return { kind: "cancelled" };
  }

  const result = await runWithInstallToken(
    async (): Promise<ProfileMediaResult> => {
      const options: ApiCallOptions = {
        apiBase: getApiBaseUrl(),
        cookie: await authClient.getCookie(),
      };
      const outcome = await uploadImage(
        picked.source,
        picked.purpose,
        callbacks,
        options
      );
      if (outcome.kind === "rejected") {
        return { kind: "error", message: rejectionMessage(outcome.reason) };
      }
      if (outcome.kind === "failed") {
        return { kind: "error", message: outcome.message };
      }
      const linked = await linkMedia(kind, outcome.mediaId, options);
      if (!linked.ok) {
        if (linked.retryable) {
          return { kind: "install-token-required" };
        }
        return { kind: "error", message: linked.message };
      }
      return { kind: "success", url: linked.url };
    },
    (value) => value.kind === "install-token-required"
  );

  // null means the user dismissed the install gate, so nothing was written.
  return result ?? { kind: "cancelled" };
}

type UploadOutcome =
  | { kind: "failed"; message: string }
  | { kind: "rejected"; reason: string | null }
  | { kind: "uploaded"; mediaId: string };

async function uploadImage(
  source: UploadSource,
  purpose: UploadPurpose,
  callbacks: ProfileMediaCallbacks,
  options: ApiCallOptions
): Promise<UploadOutcome> {
  try {
    const outcome = await uploadMedia(source, {
      onBytes: callbacks.onBytes,
      onStage: (stage) => callbacks.onStage?.(stage),
      purpose,
      // A profile image is linked the moment it is READY, so the pipeline has
      // to finish before this returns.
      waitForProcessing: true,
    });
    logInfo("profile.media_uploaded", { mediaId: outcome.mediaId, purpose });
    return { kind: "uploaded", mediaId: outcome.mediaId };
  } catch (error) {
    const message =
      error instanceof Error && "userMessage" in error
        ? String((error as { userMessage: unknown }).userMessage)
        : "That image didn't upload, try again";
    logWarn("profile.media_upload_failed", {
      purpose,
      reason: error instanceof Error ? error.message : "unknown",
    });
    void options;
    return { kind: "failed", message };
  }
}

// Web exposes a delete for both. The server routes exist; this only exists so
// the UI can call them through the same install-credential wrapper.
export async function deleteProfileMedia(
  kind: ProfileImageKind,
  runWithInstallToken: <T>(
    action: () => Promise<T>,
    isTokenRejected: (result: T) => boolean
  ) => Promise<T | null>
): Promise<ProfileMediaResult> {
  const result = await runWithInstallToken(
    async (): Promise<ProfileMediaResult> => {
      const response = await fetch(`${getApiBaseUrl()}${linkPath(kind)}`, {
        headers: { cookie: await authClient.getCookie() },
        method: "DELETE",
      });
      if (response.ok) {
        return { kind: "success", url: null };
      }
      const text = await response.clone().text();
      if (response.status === 403 && text.includes("install-token-required")) {
        return { kind: "install-token-required" };
      }
      return { kind: "error", message: "Couldn't remove that, try again" };
    },
    (value) => value.kind === "install-token-required"
  );
  return result ?? { kind: "cancelled" };
}
