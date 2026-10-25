import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import type { UploadPurpose } from "@/features/media-upload/lib/upload-api";
import type { UploadSource } from "@/features/media-upload/lib/upload-client";
import { logInfo, logWarn } from "@/lib/lifecycle/telemetry";

import {
  isTooLarge,
  PROFILE_IMAGE_MAX_BYTES,
  ProfileImageError,
} from "./profile-media-crop";
import type { ProfileImageKind } from "./profile-media-crop";

export { ProfileImageError } from "./profile-media-crop";
export type { ProfileImageKind } from "./profile-media-crop";

const PURPOSE: Record<ProfileImageKind, UploadPurpose> = {
  avatar: "avatar",
  banner: "banner",
};

// The ratio each surface renders at, used only to warn when a pick cannot be
// framed well rather than to crop it.
export const PROFILE_IMAGE_RATIO: Record<ProfileImageKind, number> = {
  avatar: 1,
  banner: 3,
};

export interface PickedProfileImage {
  purpose: UploadPurpose;
  source: UploadSource;
}

function sizeOf(uri: string, reported?: number | null): number {
  if (reported && reported > 0) {
    return reported;
  }
  try {
    return new File(uri).size;
  } catch {
    return 0;
  }
}

function dimensionsOf(
  width?: number,
  height?: number
): { height: number; width: number } | null {
  if (!width || !height || width <= 0 || height <= 0) {
    return null;
  }
  return { height, width };
}

// Returns null when the user cancels, so the caller can distinguish a cancel
// from a failure without catching.
export async function pickProfileImage(
  kind: ProfileImageKind
): Promise<PickedProfileImage | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    // Preserve original bytes, including animated GIFs, for the custom cropper.
    allowsEditing: false,
    mediaTypes: ["images"],
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,

    quality: 1,
  });
  if (result.canceled) {
    return null;
  }
  const [asset] = result.assets;
  if (!asset) {
    return null;
  }

  const bytes = sizeOf(asset.uri, asset.fileSize);
  if (isTooLarge(bytes)) {
    logWarn("profile.image_too_large", { bytes, kind });
    throw new ProfileImageError(
      "too-large",
      "That image is over 10MB, try a smaller one"
    );
  }

  const name =
    asset.fileName ?? (kind === "avatar" ? "avatar.jpg" : "banner.jpg");

  if (!dimensionsOf(asset.width, asset.height)) {
    throw new ProfileImageError(
      "unusable",
      "This image has no usable dimensions"
    );
  }
  const source: UploadSource = {
    height: asset.height || undefined,
    mimeType: asset.mimeType || "image/jpeg",
    name,
    size: bytes,
    uri: asset.uri,
    width: asset.width || undefined,
  };

  const picked = dimensionsOf(asset.width, asset.height);
  if (picked) {
    const ratio = picked.width / picked.height;
    // Only worth a log: a mismatched ratio still renders correctly, it just
    // stores more than the visible window needs.
    const drift =
      Math.abs(ratio - PROFILE_IMAGE_RATIO[kind]) / PROFILE_IMAGE_RATIO[kind];
    if (drift > 0.5) {
      logInfo("profile.image_ratio_drift", {
        drift: Math.round(drift * 100) / 100,
        kind,
        pickedRatio: Math.round(ratio * 100) / 100,
      });
    }
  }

  logInfo("profile.image_ready", {
    bytes,
    kind,
    maxBytes: PROFILE_IMAGE_MAX_BYTES,
    purpose: PURPOSE[kind],
  });

  return { purpose: PURPOSE[kind], source };
}

// Best-effort cache copy of a picked image, so the upload reads from a stable
// path rather than a provider-backed temporary URI that can be revoked
// mid-transfer. Returns the original URI when the copy is not possible.
export function stabilizePickedImage(
  picked: PickedProfileImage
): PickedProfileImage {
  try {
    const directory = new Directory(Paths.cache, "asm-profile-media");
    if (!directory.exists) {
      directory.create({ idempotent: true, intermediates: true });
    }
    const target = new File(
      directory,
      `${picked.purpose}-${Date.now()}.${picked.source.name.split(".").pop() ?? "jpg"}`
    );
    target.create({ intermediates: true, overwrite: true });
    const source = new File(picked.source.uri);
    source.copy(target);
    return {
      purpose: picked.purpose,
      source: { ...picked.source, size: target.size, uri: target.uri },
    };
  } catch (error) {
    logWarn("profile.image_stabilize_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return picked;
  }
}
