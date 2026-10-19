"use client";

import Image from "next/image";
import { useState } from "react";

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

// Community marks use the app’s rounded shape without an accent border.
export default function CommunityAvatar({
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
        "aspect-square h-fit flex-none rounded-xl",
        "bg-gradient-to-b from-[hsl(var(--muted))] to-[hsl(var(--background-alt))]",
        "object-cover",
        className
      )}
      height={size}
      onError={() => setHasError(true)}
      priority={priority}
      sizes="96px"
      src={resolvedSrc}
      unoptimized={isProxy || isDefault}
      width={size}
    />
  );
}
