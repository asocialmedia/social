"use client";

import { Button } from "@asm/ui/shadui/button";
import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
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
          Page not found
        </h1>
        <p className="max-w-sm text-muted-foreground text-sm">
          The page you're looking for doesn't exist or has been moved.
        </p>
      </div>
      <Button asChild variant="premium">
        <Link href="/">Return Home</Link>
      </Button>
    </div>
  );
}
