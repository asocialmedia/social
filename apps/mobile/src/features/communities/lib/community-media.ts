// Banner and avatar upload for the community creation wizard.
//
// Web uploads imagery on selection, creates the community, then links the two
// ids through /api/communities/{slug}/{avatar,banner}. The same three steps
// happen here, split across two functions because the community does not exist
// until after the upload: uploadCommunityMedia runs first, and
// linkCommunityMedia runs once the slug comes back.
//
// The pick and transfer logic is reused from the profile editor rather than
// reimplemented, so both surfaces crop, size-check and stabilize identically.

import type { ImageSourcePropType } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import {
  pickProfileImage,
  stabilizePickedImage,
} from "@/features/profile/lib/profile-media";
import type { ProfileImageKind } from "@/features/profile/lib/profile-media";
import { uploadImage } from "@/features/profile/lib/profile-media-mutations";
import type { UploadOutcome } from "@/features/profile/lib/profile-media-mutations";
import { getApiBaseUrl } from "@/lib/api-env";
import { logInfo, logWarn } from "@/lib/telemetry";

export type CommunityMediaSlot = "avatar" | "banner";

export interface CommunityMediaUpload {
  mediaId: string;
  source: ImageSourcePropType;
}

// uploadImage surfaces its own failure kinds rather than the install-token
// rejection the gate retries on, so the upload is never re-driven by the gate.
function isTokenRejected(_result: UploadOutcome): boolean {
  return false;
}

/**
 * Picks and uploads one community image, returning the media id to link after
 * the community exists. Returns null when the reader cancels the picker.
 */
export async function uploadCommunityMedia({
  runWithInstallToken,
  slot,
  ...options
}: ApiCallOptions & {
  runWithInstallToken: <T>(
    action: () => Promise<T>,
    isTokenRejected: (result: T) => boolean
  ) => Promise<T | null>;
  slot: CommunityMediaSlot;
}): Promise<CommunityMediaUpload | null> {
  // The profile picker already encodes the per-slot crop and size rules, and
  // the community slots are the same two shapes.
  const kind = slot as ProfileImageKind;
  let picked: Awaited<ReturnType<typeof pickProfileImage>>;
  try {
    picked = await pickProfileImage(kind);
  } catch (error) {
    logWarn("community_create.media_pick_failed", {
      reason: error instanceof Error ? error.message : "unknown",
      slot,
    });
    throw error instanceof Error
      ? error
      : new Error("Couldn't process that image");
  }
  if (!picked) {
    return null;
  }
  const stable = stabilizePickedImage(picked);

  const outcome: UploadOutcome | null = await runWithInstallToken(
    async () => await uploadImage(stable.source, stable.purpose, {}, options),
    isTokenRejected
  );

  if (!outcome) {
    // null means the install gate was dismissed, so nothing was uploaded.
    return null;
  }
  if (outcome.kind !== "uploaded") {
    logWarn("community_create.media_upload_failed", {
      reason: outcome.kind,
      slot,
    });
    throw new Error(
      outcome.kind === "failed" ? outcome.message : "Couldn't upload that image"
    );
  }
  logInfo("community_create.media_uploaded", { slot });
  return { mediaId: outcome.mediaId, source: stable.source };
}

/**
 * Attaches an uploaded id to the freshly created community. A failure here is
 * reported, not thrown: the community already exists, so losing its imagery
 * must not read as losing the community.
 */
export async function linkCommunityMedia({
  apiBase,
  baseFetch = fetch,
  cookie,
  mediaId,
  slot,
  slug,
}: ApiCallOptions & {
  mediaId: string;
  slot: CommunityMediaSlot;
  slug: string;
}): Promise<boolean> {
  try {
    const response = await baseFetch(
      `${apiBase.replace(/\/+$/, "")}/api/communities/${encodeURIComponent(slug)}/${slot}`,
      {
        body: JSON.stringify({ mediaId }),
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        method: "POST",
      }
    );
    if (!response.ok) {
      logWarn("community_create.media_link_failed", {
        reason: response.status,
        slot,
        slug,
      });
      return false;
    }
    return true;
  } catch (error) {
    logWarn("community_create.media_link_failed", {
      reason: error instanceof Error ? error.message : String(error),
      slot,
      slug,
    });
    return false;
  }
}

/** Convenience for the wizard: the API base and session cookie together. */
export async function communityMediaAuth(): Promise<ApiCallOptions> {
  return { apiBase: getApiBaseUrl(), cookie: await authClient.getCookie() };
}
