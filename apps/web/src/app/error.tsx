"use client";

import { Button } from "@asm/ui/shadui/button";
import Image from "next/image";

// biome-ignore lint/suspicious/noShadowRestrictedNames: This is a custom error boundary component
export default function Error({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-6 bg-background p-4">
      <Image
        alt="Asocialmedia"
        className="opacity-80"
        height={64}
        src="/asocialmedialogo.svg"
        width={64}
      />
      <div className="space-y-2 text-center">
        <h1 className="font-semibold text-foreground text-xl">
          Something went wrong
        </h1>
        <p className="max-w-sm text-muted-foreground text-sm">
          An unexpected error occurred. Please try again.
        </p>
      </div>
      <Button onClick={reset} variant="premium">
        Try Again
      </Button>
    </div>
  );
}
