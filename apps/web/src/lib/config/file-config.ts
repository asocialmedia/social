import { FILE_CONFIGS } from "../utils/mime-utils";

export type FileCategory = "IMAGE" | "VIDEO" | "AUDIO" | "CODE" | "DOCUMENT";

export const maxFileSizes = {
  AUDIO: 20 * 1024 * 1024,
  CODE: 10 * 1024 * 1024,
  DOCUMENT: 200 * 1024 * 1024,
  IMAGE: 25 * 1024 * 1024,
  VIDEO: 250 * 1024 * 1024,
} as const;

export const FILE_SIZE_UNITS = {
  GB: 1024 * 1024 * 1024,
  KB: 1024,
  MB: 1024 * 1024,
} as const;

export type AllowedAvatarExtension =
  | "jpg"
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "heic"
  | "heif";

export const avatarConfig = {
  allowedExtensions: [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "heic",
    "heif",
  ] as AllowedAvatarExtension[],
  maxSize: 8 * 1024 * 1024,
} as const;

export const getAllowedMimeTypes = () =>
  Object.values(FILE_CONFIGS).map((config) => config.mime);

export type AllowedFileType = ReturnType<typeof getAllowedMimeTypes>[number];

export const allowedFileTypes = getAllowedMimeTypes();

export const formatFileSize = (bytes: number): string => {
  if (bytes < FILE_SIZE_UNITS.MB) {
    return `${(bytes / FILE_SIZE_UNITS.KB).toFixed(2)} KB`;
  }
  return `${(bytes / FILE_SIZE_UNITS.MB).toFixed(2)} MB`;
};
