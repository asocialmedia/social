import { clientLog } from "@asm/config/debug";

import { avatarConfig, maxFileSizes } from "../config/file-config";
import type { AllowedAvatarExtension } from "../config/file-config";
import { getFileConfigFromMime } from "./mime-utils";

export const validateFile = (file: File) => {
  if (!file) {
    throw new Error("No file provided");
  }

  const fileConfig = getFileConfigFromMime(file.type);
  clientLog.log("File validation:", {
    config: fileConfig,
    size: file.size,
    type: file.type,
  });

  if (!fileConfig) {
    throw new Error(`File type ${file.type} not supported`);
  }

  const { category } = fileConfig;
  const maxSize = maxFileSizes[category];

  if (file.size > maxSize) {
    const sizeMb = Math.round(maxSize / (1024 * 1024));
    throw new Error(
      `File size must be less than ${sizeMb}MB for ${category} files`
    );
  }

  return true;
};

const isAllowedExtension = (
  ext: string | undefined
): ext is AllowedAvatarExtension =>
  !!ext &&
  avatarConfig.allowedExtensions.includes(ext as AllowedAvatarExtension);

export const validateAvatar = (file: File) => {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (!isAllowedExtension(extension)) {
    throw new Error("Avatar must be in JPG, PNG, GIF, WebP, or HEIC format");
  }

  if (file.size > avatarConfig.maxSize) {
    throw new Error("Avatar size must be less than 8MB");
  }

  return true;
};
