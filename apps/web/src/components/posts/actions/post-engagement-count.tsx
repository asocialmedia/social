import { Flame, Heart } from "lucide-react";

import { getAuraFlameClass } from "@/lib/aura/aura";
import { cn, formatNumber } from "@/lib/utils";

export function PostEngagementCount({
  aura,
  className,
  iconClassName,
  likeCount,
}: {
  aura: number;
  className?: string;
  iconClassName?: string;
  // A null source count is unavailable; an omitted count selects native Aura.
  likeCount?: number | null;
}) {
  const isSourceLikes = likeCount !== undefined;
  const count = isSourceLikes ? likeCount : aura;
  const label = isSourceLikes ? "Likes on Bluesky" : "Aura";
  return (
    <span
      aria-label={
        count === null ? `${label} unavailable` : `${label}: ${count}`
      }
      className={className}
      title={label}
    >
      {isSourceLikes ? (
        <Heart aria-hidden className={iconClassName} />
      ) : (
        <Flame
          aria-hidden
          className={cn(iconClassName, getAuraFlameClass(aura))}
        />
      )}
      {count === null ? "—" : formatNumber(count)}
    </span>
  );
}
