"use client";

import { Button } from "@asm/ui/shadui/button";
import authImage from "@assets/general/auth.png";
import Image from "next/image";
import Link from "next/link";
import type React from "react";

import { cn } from "@/lib/utils";

interface AuthPromptCardProps {
  className?: string;
  description?: string;
  imageSize?: number;
  primaryLabel?: string;
  secondaryLabel?: string;
  showImage?: boolean;
  title: string;
}

// Reusable login/signup prompt with the auth.png graphic centered. Used for
// guest users wherever a feature is gated behind an account (e.g. the
// Following tab and the homepage "Get your account" sidebar card).
export const AuthPromptCard: React.FC<AuthPromptCardProps> = ({
  className,
  description,
  imageSize = 96,
  primaryLabel = "Log in",
  secondaryLabel = "Sign up",
  showImage = true,
  title,
}) => (
  <div
    className={cn(
      "sidebar-subcard flex flex-col items-center gap-3 rounded-2xl p-5 text-center",
      className
    )}
  >
    {showImage ? (
      <Image
        alt=""
        aria-hidden
        className="h-auto object-contain"
        draggable={false}
        height={imageSize}
        src={authImage}
        width={imageSize}
      />
    ) : null}
    <div className="space-y-1">
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? (
        <p className="text-muted-foreground text-sm">{description}</p>
      ) : null}
    </div>
    <div className="flex w-full items-center justify-center gap-2">
      <Button asChild className="h-9 flex-1 px-4 text-sm" variant="premium">
        <Link href="/login">{primaryLabel}</Link>
      </Button>
      <Button asChild className="h-9 flex-1 px-4 text-sm" variant="outline">
        <Link href="/signup">{secondaryLabel}</Link>
      </Button>
    </div>
  </div>
);
