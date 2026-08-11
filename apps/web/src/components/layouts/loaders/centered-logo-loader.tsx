"use client";

import Image from "next/image";

export function CenteredLogoLoader({ size = 56 }: { size?: number }) {
  return (
    <div className="flex w-full items-center justify-center py-16">
      <div className="animate-pulse">
        <Image
          alt="Asocialmedia"
          className="opacity-80"
          height={size}
          priority
          src="/asocialmedialogo.svg"
          width={size}
        />
      </div>
    </div>
  );
}
