"use client";

import authorBadge from "@assets/roles/author.png";
import devBadge from "@assets/roles/dev.png";
import earlyBadge from "@assets/roles/early.png";
import Image from "next/image";
import { memo } from "react";

import { cn } from "@/lib/utils";

export type UserBadgeType = "author" | "dev" | "early";

const BADGE_IMAGES: Record<UserBadgeType, { src: string; alt: string }> = {
  author: { alt: "Author badge", src: authorBadge.src },
  dev: { alt: "Developer badge", src: devBadge.src },
  early: { alt: "Early supporter badge", src: earlyBadge.src },
};

// Maps a stored user badge value to a known type. Unknown values render
// nothing so a bad DB toggle never shows a broken image.
export function normalizeBadge(
  value: string | null | undefined
): UserBadgeType | null {
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (
    normalized === "author" ||
    normalized === "dev" ||
    normalized === "early"
  ) {
    return normalized;
  }
  return null;
}

// Blue-tick style role badge shown next to a username. Sits inline with the
// name and inherits its line height; a small title surfaces the badge label.
const UserBadge: React.FC<{
  badge: string | null | undefined;
  className?: string;
}> = ({ badge, className }) => {
  const type = normalizeBadge(badge);
  if (!type) {
    return null;
  }
  const { alt, src } = BADGE_IMAGES[type];
  return (
    <span
      aria-label={alt}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center",
        className
      )}
      title={`${type[0].toUpperCase()}${type.slice(1)}`}
    >
      <Image
        alt=""
        className="h-full w-full object-contain"
        height={16}
        src={src}
        unoptimized
        width={16}
      />
    </span>
  );
};

export default memo(UserBadge);
