import type { UserData } from "@asm/db";
import Image from "next/image";
import { useState } from "react";

import { cn, isGifUrl, supportsTransparency } from "@/lib/utils";
import { getDefaultAvatar, getSecureImageUrl } from "@/lib/utils/image-url";

interface UserAvatarProps {
  avatarUrl?: string | null;
  className?: string;
  priority?: boolean;
  seed?: string | null;
  size?: number;
  user?:
    | (Pick<UserData, "avatarUrl"> & {
        id?: string;
        username?: string;
      })
    | null;
}

export default function UserAvatar({
  user,
  avatarUrl: directAvatarUrl,
  seed,
  size,
  className,
  priority = false,
}: UserAvatarProps) {
  const [hasError, setHasError] = useState(false);
  const avatarUrl = user?.avatarUrl ?? directAvatarUrl;
  const hasAvatar =
    !hasError && typeof avatarUrl === "string" && avatarUrl.trim().length > 0;
  const resolvedSrc = hasAvatar
    ? getSecureImageUrl(avatarUrl)
    : getDefaultAvatar(user?.id || user?.username || seed);
  const transparent = supportsTransparency(resolvedSrc);
  const isDefaultAvatar = resolvedSrc.startsWith("/avatars/");
  // Storage avatars are served through our /api/users/avatar/{id}/image proxy
  // (already sized variants). The image optimizer rejects same-origin /api/
  // URLs, so skip optimization for those; static default avatars can keep it.
  const isProxyAvatar = resolvedSrc.startsWith("/api/");
  // Optimistic previews carry object URLs (blob:), which only the uploading
  // client can resolve - the optimizer endpoint would 400 them into the
  // default-avatar fallback, so they must render unoptimized too.
  const isBlobUrl = avatarUrl?.startsWith("blob:") === true;

  return (
    <Image
      alt="User avatar"
      className={cn(
        "avatar-ring aspect-square h-fit flex-none rounded-xl",
        "bg-gradient-to-b from-[hsl(var(--muted))] to-[hsl(var(--background-alt))]",
        transparent ? "object-contain" : "object-cover",
        className
      )}
      height={size ?? 48}
      onError={() => setHasError(true)}
      priority={priority}
      src={resolvedSrc}
      unoptimized={
        isDefaultAvatar || isProxyAvatar || isBlobUrl || isGifUrl(avatarUrl)
      }
      width={size ?? 48}
    />
  );
}
