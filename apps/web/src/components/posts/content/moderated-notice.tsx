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
//
// `vertical` is for tall media-tile shapes (the profile media sidebar) where
// the notice is centered in a column: icon above, text below. `bare` strips the
// notice's own border/background so it can sit inside an existing framed tile.
const ModeratedNotice: React.FC<{
  bare?: boolean;
  className?: string;
  compact?: boolean;
  kind?: "gust" | "post";
  style?: React.CSSProperties;
  vertical?: boolean;
}> = ({
  className,
  kind = "post",
  compact = false,
  vertical = false,
  bare = false,
  style,
}) => {
  let containerClass = "gap-3 px-4 py-2.5";
  let iconSize = "size-12";
  let iconHeight = 48;
  let iconWidth = 48;
  if (vertical) {
    containerClass = "flex-col gap-2 px-3 py-4 text-center";
    iconSize = "size-12";
    iconHeight = 48;
    iconWidth = 48;
  } else if (compact) {
    containerClass = "gap-2 px-2.5 py-1.5";
    iconSize = "size-5";
    iconHeight = 20;
    iconWidth = 20;
  }

  let content: React.ReactNode;
  if (vertical) {
    content = (
      <div className="min-w-0">
        <p className="text-foreground text-sm leading-tight font-semibold">
          This {kind} seemed harmful
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-tight">
          Tucked away to keep the feed a good place.
        </p>
      </div>
    );
  } else if (compact) {
    content = (
      <p className="text-foreground text-xs leading-tight font-semibold">
        This {kind} seemed harmful
      </p>
    );
  } else {
    content = (
      <div className="min-w-0">
        <p className="text-foreground text-sm leading-tight font-semibold">
          This {kind} seemed harmful
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-tight">
          So it&apos;s been tucked away to keep the feed a good place. No harm
          meant, and everyone&apos;s welcome back.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center rounded-xl",
        bare
          ? "border-0 bg-transparent shadow-none"
          : "bg-muted border-border/60 border border-solid shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_1px_2px_rgba(255,255,255,0.05)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05),inset_0_1px_2px_rgba(255,255,255,0.04)]",
        containerClass,
        className
      )}
      style={style}
    >
      <Image
        alt=""
        className={cn("shrink-0 object-contain", iconSize)}
        draggable={false}
        height={iconHeight}
        sizes={`${iconWidth}px`}
        src={errorImage}
        width={iconWidth}
      />
      {content}
    </div>
  );
};

export default ModeratedNotice;
