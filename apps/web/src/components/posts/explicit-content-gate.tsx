"use client";

import { Button } from "@asm/ui/shadui/button";
import { EyeOff } from "lucide-react";
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
  label?: string;
  onReveal?: () => void;
}> = ({
  children,
  className,
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
        className="pointer-events-none h-full w-full scale-105 opacity-60 blur-xl saturate-50"
      >
        {children}
      </div>
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
        <div className="apple-panel flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl p-5 text-center">
          <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full">
            <EyeOff className="text-muted-foreground size-5" />
          </div>
          <div>
            <p className="text-foreground text-sm font-semibold">{label}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Do you want to continue watching?
            </p>
          </div>
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
};

export default ExplicitContentGate;
