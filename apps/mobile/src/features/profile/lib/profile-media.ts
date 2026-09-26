// Native counterpart of web's `profile-media-inputs.tsx` (AvatarInput /
// BannerInput). The web flow is: guard the size, let a GIF bypass the raster
// path, resize to a working canvas as WEBP, crop to the target ratio, then hand
// the blob to the uploader with purpose "avatar" / "banner".
//
// Native collapses the resize and the crop into the picker's own native editor
// (`allowsEditing`), the platform equivalent of web's CropImageDialog, then
// re-applies web's exact output geometry with expo-image-manipulator so the
// bytes uploaded match what the web build sends. The geometry itself lives in
// ./profile-media-crop, which stays free of native imports so it is testable.
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import type { UploadPurpose } from "@/features/media-upload/lib/upload-api";
import type { UploadSource } from "@/features/media-upload/lib/upload-client";
import { logInfo, logWarn } from "@/lib/telemetry";

import {
  coverCrop,
  isAnimatedImage,
  isTooLarge,
  PROFILE_IMAGE_TARGETS,
  ProfileImageError,
} from "./profile-media-crop";
import type { ProfileImageKind } from "./profile-media-crop";

export { ProfileImageError } from "./profile-media-crop";
export type { ProfileImageKind } from "./profile-media-crop";

const PURPOSE: Record<ProfileImageKind, UploadPurpose> = {
  avatar: "avatar",
  banner: "banner",
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

// Returns null when the user cancels, so the caller can distinguish a cancel
// from a failure without catching.
export async function pickProfileImage(
  kind: ProfileImageKind
): Promise<PickedProfileImage | null> {
  const target = PROFILE_IMAGE_TARGETS[kind];
  const result = await ImagePicker.launchImageLibraryAsync({
    // The native editor is web's CropImageDialog: it hands back an already
    // cropped frame, so no second crop pass is needed on top of this.
    allowsEditing: true,
    mediaTypes: ["images"],
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
  if (isAnimatedImage(asset.mimeType, name)) {
    logWarn("profile.image_animated_unsupported", { kind });
    throw new ProfileImageError(
      "unusable",
      "Animated images can't be used here, try a still one"
    );
  }

  // The picker reports the source dimensions, so planning the crop needs no
  // extra decode. A missing value (some pickers omit it) falls back to the
  // target box, which turns the cover-crop into a plain resize.
  const crop = coverCrop(target, {
    height: asset.height || target.height,
    width: asset.width || target.width,
  });

  const rendered = await ImageManipulator.manipulate(asset.uri)
    .resize({
      height: Math.max(
        1,
        Math.round((asset.height || target.height) * crop.scale)
      ),
      width: Math.max(
        1,
        Math.round((asset.width || target.width) * crop.scale)
      ),
    })
    .crop({
      height: crop.height,
      originX: crop.originX,
      originY: crop.originY,
      width: crop.width,
    })
    .renderAsync();

  const directory = new Directory(Paths.cache, "asm-profile-media");
  if (!directory.exists) {
    directory.create({ idempotent: true, intermediates: true });
  }
  const output = new File(directory, `${kind}-${Date.now()}.webp`);
  const saved = await rendered.saveAsync({
    compress: 0.9,
    format: SaveFormat.WEBP,
  });

  logInfo("profile.image_ready", {
    bytes: sizeOf(saved.uri),
    height: saved.height,
    kind,
    purpose: PURPOSE[kind],
    width: saved.width,
  });

  return {
    purpose: PURPOSE[kind],
    source: {
      height: saved.height,
      mimeType: "image/webp",
      name: output.name,
      size: sizeOf(saved.uri),
      uri: saved.uri,
      width: saved.width,
    },
  };
}
