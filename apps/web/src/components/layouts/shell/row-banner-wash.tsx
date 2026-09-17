"use client";

import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

// The banner wash behind a card row: the subject's header image pinned to the
// top-left corner, brushed out by two gradient passes so it never reads as a
// hard-edged picture pasted onto the surface.
//
// Extracted from the home rail's "who to follow" rows and shared, so the
// suggestion rows, the community roster, the community leaderboard and the
// community About card all paint a header the same way.
//
// `className` scopes WHERE the wash sits. Defaults to the full row; a taller
// card passes a height (e.g. `h-[30%]`) to keep the image to a top band rather
// than washing the whole surface behind a lot of text.
//
// Returns `null` when there is no banner, or when the image fails to load - the
// surface simply sits plain then, no empty frame.
export default function RowBannerWash({
  bannerUrl,
  className,
}: {
  bannerUrl?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!bannerUrl || failed) {
    return null;
  }

  return (
    // `h-full`, not `inset-0`: height is its own merge group, so a caller's
    // `h-[30%]` wins cleanly. `bottom` is left unset so the height decides
    // where the wash ends.
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden",
        className
      )}
    >
      <Image
        alt=""
        className="object-cover"
        fill
        onError={() => setFailed(true)}
        sizes="256px"
        src={getSecureImageUrl(bannerUrl)}
        unoptimized
      />
      {/* Right-to-left: panel surface on the left where the text sits, image
          left visible on the right. */}
      <div className="absolute inset-0 bg-linear-to-l from-[hsl(var(--background-alt))] via-[hsl(var(--background-alt)/0.8)] to-transparent" />
      {/* Bottom-up, stacked over the first pass: together they pin the visible
          part of the image to the top-left corner alone. */}
      <div className="absolute inset-0 bg-gradient-to-t from-[hsl(var(--background-alt))] via-[hsl(var(--background-alt)/0.55)] to-transparent" />
      {/* A short fade at the very bottom so the band dissolves rather than
          ending on the image's own crop line. */}
      <div className="absolute inset-x-0 bottom-0 h-2.5 bg-gradient-to-b from-transparent to-[hsl(var(--background-alt))]" />
    </div>
  );
}
