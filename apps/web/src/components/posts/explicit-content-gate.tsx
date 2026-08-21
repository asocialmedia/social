"use client";

import { Button } from "@asm/ui/shadui/button";
import nosearchImage from "@assets/general/nosearch.png";
import Image from "next/image";
import type * as React from "react";
import { useState } from "react";

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
  label?: string;
  onReveal?: () => void;
}> = ({
  children,
  className,
  blurClassName = "rounded-xl",
  label = "This post has explicit media.",
  onReveal,
}) => {
  const [revealed, setRevealed] = useState(false);

  const handleContinue = () => {
    setRevealed(true);
    onReveal?.();
  };

  if (revealed) {
    return children;
  }

  return (
    <div className={cn("relative w-full overflow-hidden", className)}>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none h-full w-full scale-105 opacity-60 blur-xl saturate-50",
          blurClassName
        )}
      >
        {children}
      </div>
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
    </div>
  );
};

export default ExplicitContentGate;
