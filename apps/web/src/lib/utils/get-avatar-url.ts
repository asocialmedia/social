import { getDefaultAvatar, getSecureImageUrl } from "./image-url";

export const getAvatarUrl = (
  avatarUrl: string | null | undefined,
  seed?: string | null
): string => {
  if (!avatarUrl || avatarUrl.trim().length === 0) {
    return getDefaultAvatar(seed);
  }
  return getSecureImageUrl(avatarUrl);
};
