import errorImage from "@assets/general/error.png";
import Image from "next/image";
import type * as React from "react";

import { cn } from "@/lib/utils";

// Replaces a post's/gust's content when an admin or the author has flagged it
// as moderated. The row stays in the database; only the rendering is swapped
// for a notice. Solid dual border: an outer border plus an inset hairline ring,
// matching the app's panel language instead of a dashed outline.
//
// `compact` is for small list rows (recents, author sidebar, message embeds,
// gust row cards) where the full 48px-avatar + two-line notice would tower over
// the neighbouring rows - it collapses to a single-line chip that matches the
// content height it replaces.
const ModeratedNotice: React.FC<{
  className?: string;
  compact?: boolean;
  kind?: "gust" | "post";
}> = ({ className, kind = "post", compact = false }) => (
  <div
    className={cn(
      "bg-muted border-border/60 flex items-center rounded-xl border border-solid shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_1px_2px_rgba(255,255,255,0.05)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05),inset_0_1px_2px_rgba(255,255,255,0.04)]",
      compact ? "gap-2 px-2.5 py-1.5" : "gap-3 px-4 py-2.5",
      className
    )}
  >
    <Image
      alt=""
      className={cn("shrink-0 object-contain", compact ? "size-5" : "size-12")}
      draggable={false}
      height={compact ? 20 : 48}
      sizes={compact ? "20px" : "48px"}
      src={errorImage}
      width={compact ? 20 : 48}
    />
    {compact ? (
      <p className="text-foreground text-xs leading-tight font-semibold">
        This {kind} seemed harmful
      </p>
    ) : (
      <div className="min-w-0">
        <p className="text-foreground text-sm leading-tight font-semibold">
          This {kind} seemed harmful
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-tight">
          So it&apos;s been tucked away to keep the feed a good place. No harm
          meant, and everyone&apos;s welcome back.
        </p>
      </div>
    )}
  </div>
);

export default ModeratedNotice;
