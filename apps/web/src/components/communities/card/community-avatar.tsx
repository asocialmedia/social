"use client";

import Image from "next/image";
import { useState } from "react";

import { communityAccentStyle } from "@/lib/communities/accent";
import { cn } from "@/lib/utils";
import { getDefaultAvatar } from "@/lib/utils/image-url";

interface CommunityAvatarProps {
  accentColor: string;
  avatarUrl?: string | null;
  className?: string;
  name: string;
  priority?: boolean;
  size?: number;
  slug: string;
}

// Community mark. Same shape and depth as the app's UserAvatar (rounded-xl with
// the .avatar-ring 3D lip and the muted-to-background gradient backing), with
// the outer edge swapped to the community's accent via .community-avatar-ring.
// Falls back to a deterministic default avatar seeded by the slug when the
// community has not uploaded one.
export default function CommunityAvatar({
  accentColor,
  avatarUrl,
  className,
  name,
  priority = false,
  size = 48,
  slug,
}: CommunityAvatarProps) {
  const [hasError, setHasError] = useState(false);
  const hasAvatar =
    !hasError && typeof avatarUrl === "string" && avatarUrl.trim().length > 0;
  const resolvedSrc = hasAvatar ? avatarUrl : getDefaultAvatar(slug);
  const isProxy = resolvedSrc.startsWith("/api/");
  const isDefault = resolvedSrc.startsWith("/avatars/");

  return (
    <Image
      alt={`${name} community`}
      className={cn(
        "community-avatar-ring aspect-square h-fit flex-none rounded-xl",
        "bg-gradient-to-b from-[hsl(var(--muted))] to-[hsl(var(--background-alt))]",
        "object-cover",
        className
      )}
      height={size}
      onError={() => setHasError(true)}
      priority={priority}
      sizes="96px"
      src={resolvedSrc}
      style={communityAccentStyle(accentColor)}
      unoptimized={isProxy || isDefault}
      width={size}
    />
  );
}
