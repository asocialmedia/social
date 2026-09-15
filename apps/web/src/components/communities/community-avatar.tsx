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
  slug: string;
}

// Community mark. When the community has uploaded an avatar it renders the real
// image; otherwise it falls back to a deterministic default avatar seeded by
// the slug. The accent only supplies the ring, never a tile behind the mark.
export default function CommunityAvatar({
  accentColor,
  avatarUrl,
  className,
  name,
  priority = false,
  slug,
}: CommunityAvatarProps) {
  const [hasError, setHasError] = useState(false);
  const hasAvatar =
    !hasError && typeof avatarUrl === "string" && avatarUrl.trim().length > 0;
  const resolvedSrc = hasAvatar ? avatarUrl : getDefaultAvatar(slug);
  const isProxy = resolvedSrc.startsWith("/api/");
  const isDefault = resolvedSrc.startsWith("/avatars/");

  return (
    <span
      className={cn(
        "ring-2 ring-[var(--community-accent)] ring-offset-2 ring-offset-[hsl(var(--background-alt))] dark:ring-[var(--community-accent-dark)]",
        "relative inline-flex shrink-0 overflow-hidden rounded-full",
        className
      )}
      style={communityAccentStyle(accentColor)}
    >
      <Image
        alt={`${name} community`}
        className="size-full object-cover"
        fill
        onError={() => setHasError(true)}
        priority={priority}
        sizes="96px"
        src={resolvedSrc}
        unoptimized={isProxy || isDefault}
      />
    </span>
  );
}
