"use client";

import { Button } from "@asm/ui/shadui/button";
import nosearchImage from "@assets/general/nosearch.png";
import Image from "next/image";
import type * as React from "react";
import { useState } from "react";

import {
  revealExplicit,
  useExplicitRevealed,
} from "@/lib/explicit-reveal-store";
import { cn } from "@/lib/utils";

// Blurs wrapped media behind a "this content has explicit media" gate with a
// Continue button. The media stays mounted but visually blurred and muted, so
// the reveal is instant and there is nothing to refetch. The dismissal is per
// mount (per post) - navigating away and back re-gates, which is the expected
// behaviour for a warning gate.
const ExplicitContentGate: React.FC<{
  children: React.ReactNode;
  className?: string;
  // Rounding for the blurred copy, so its corners follow the media frame
  // beneath it (post media tiles are rounded-xl, gusts are rounded-2xl/3xl).
  blurClassName?: string;
  // Compact mode for small list-row thumbnails (recents, author sidebar,
  // message embeds, gust row cards): instead of the full panel + Continue
  // button, a blurred thumb with a small "Explicit" chip and a tap-to-reveal.
  compact?: boolean;
  label?: string;
  onReveal?: () => void;
  // When set (usually the post id), the dismissal is shared across every
  // surface rendering the same post - feed card, post page, and the
  // fullscreen media page - so Continue is confirmed once, not per mount.
  // Without a key the gate falls back to per-mount local state.
  revealKey?: string;
}> = ({
  children,
  className,
  blurClassName = "rounded-xl",
  compact = false,
  label = "This post has explicit media.",
  onReveal,
  revealKey,
}) => {
  const [localRevealed, setLocalRevealed] = useState(false);
  const sharedRevealed = useExplicitRevealed(revealKey);
  const revealed = revealKey ? sharedRevealed : localRevealed;

  const handleContinue = () => {
    if (revealKey) {
      revealExplicit(revealKey);
    } else {
      setLocalRevealed(true);
    }
    onReveal?.();
  };

  // The compact gate is often rendered inside a Link (row cards). The reveal
  // click must reveal the media, not navigate the link underneath.
  const handleCompactReveal = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    handleContinue();
  };

  // The children stay in one stable wrapper for both states so media elements
  // (e.g. the gust video) are never unmounted/remounted on reveal; only the
  // blur styling and the overlay toggle.
  let overlay: React.ReactNode = null;
  if (!revealed) {
    overlay = compact ? (
      // Compact mode for small list-row thumbnails: the (already blurred) media
      // shows through with the nosearch avatar centered on top. The whole
      // surface is a transparent button that reveals the media on tap.
      <button
        aria-label="Show content"
        className="absolute inset-0 z-10 flex cursor-pointer items-center justify-center border-0 bg-transparent"
        onClick={handleCompactReveal}
        type="button"
      >
        <Image
          alt=""
          className="size-7 shrink-0 object-contain opacity-85"
          draggable={false}
          height={28}
          sizes="28px"
          src={nosearchImage}
          width={28}
        />
      </button>
    ) : (
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
        <div className="apple-panel flex w-full max-w-xs flex-col gap-3 rounded-2xl p-4">
          <div className="flex items-center gap-3 text-left">
            <Image
              alt=""
              className="size-12 shrink-0 object-contain"
              draggable={false}
              height={48}
              sizes="48px"
              src={nosearchImage}
              width={48}
            />
            <div className="min-w-0">
              <p className="text-foreground text-sm leading-tight font-semibold">
                {label}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs leading-tight">
                Do you want to continue watching?
              </p>
            </div>
          </div>
          <div className="flex justify-center">
            <Button
              className="rounded-full px-6"
              onClick={handleContinue}
              type="button"
              variant="premium"
            >
              Continue
            </Button>
          </div>
        </div>
      </div>
    );
  }

  let childrenClass = "";
  if (!revealed) {
    childrenClass = compact
      ? "pointer-events-none h-full opacity-80 blur-md"
      : "pointer-events-none h-full scale-105 opacity-60 blur-xl saturate-50";
  }

  return (
    <div className={cn("relative w-full overflow-hidden", className)}>
      <div
        aria-hidden={revealed ? undefined : true}
        className={cn(
          "h-full w-full transition-[filter,opacity,transform] duration-200",
          childrenClass,
          !revealed && blurClassName
        )}
        // While blurred, focusable descendants (media controls, links) must not
        // be reachable by keyboard; `inert` removes them from the tab order.
        inert={revealed ? undefined : true}
      >
        {children}
      </div>
      {overlay}
    </div>
  );
};

export default ExplicitContentGate;
