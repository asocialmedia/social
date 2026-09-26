// Native counterpart of web's `profile-media-inputs.tsx` (AvatarInput /
// BannerInput).
//
// Web resizes with react-image-file-resizer and crops with cropperjs, because a
// browser can do both cheaply. Native has no equivalent that ships without a new
// native module: expo-image-manipulator would work but requires a full native
// rebuild to add, which is not a trade worth making for a profile picture. So
// the crop is delegated to the platform's own image editor, which
// expo-image-picker exposes as `allowsEditing`, and the resize is left to the
// media pipeline that already derives every size server-side.
//
// The one honest difference: a banner is not destructively cropped to 3:1 on
// native. It is not letterboxed either, because every banner surface renders
// with contentFit cover, so the framing is identical - only the stored bytes
// carry more than the visible window.
import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import type { UploadPurpose } from "@/features/media-upload/lib/upload-api";
import type { UploadSource } from "@/features/media-upload/lib/upload-client";
import { logInfo, logWarn } from "@/lib/telemetry";

import {
  isAnimatedImage,
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
    // The platform editor is the crop step. iOS squares the result, which is
    // exactly right for an avatar; a banner keeps the framed window the user
    // chose, and contentFit cover presents it identically either way.
    allowsEditing: true,
    mediaTypes: ["images"],
    // The server strips metadata and builds every derivative, so there is no
    // reason to ship a larger original than the editor already produced.
    quality: 0.9,
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
  if (isAnimatedImage(asset.mimeType, name)) {
    logWarn("profile.image_animated_unsupported", { kind });
    throw new ProfileImageError(
      "unusable",
      "Animated images can't be used here, try a still one"
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

/**
 * Best-effort cache copy of a picked image, so the upload reads from a stable
 * path rather than a provider-backed temporary URI that can be revoked
 * mid-transfer. Returns the original URI when the copy is not possible.
 */
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
