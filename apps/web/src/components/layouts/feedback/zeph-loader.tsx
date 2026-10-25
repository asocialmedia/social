import mediaArtwork from "@assets/general/zeph-loading-media.webp";
import messagesArtwork from "@assets/general/zeph-loading-messages.webp";
import searchArtwork from "@assets/general/zeph-loading-search.webp";
import securityArtwork from "@assets/general/zeph-loading-security.webp";
import waitingArtwork from "@assets/general/zeph-loading-waiting.webp";
import Image from "next/image";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const ARTWORK = {
  general: waitingArtwork,
  media: mediaArtwork,
  messages: messagesArtwork,
  search: searchArtwork,
  security: securityArtwork,
};
export type ZephLoaderVariant = keyof typeof ARTWORK;

export function ZephLoader({
  className,
  label = "Loading",
  size,
  style,
  variant = "general",
  ...props
}: HTMLAttributes<HTMLOutputElement> & {
  label?: string;
  size?: number;
  variant?: ZephLoaderVariant;
}) {
  return (
    <output
      aria-label={label}
      className={cn(
        "relative inline-flex size-6 shrink-0 items-center justify-center align-middle",
        className
      )}
      style={{
        ...(size === undefined ? {} : { height: size, width: size }),
        ...style,
      }}
      {...props}
    >
      <Image
        alt=""
        aria-hidden
        className="h-full w-full object-contain motion-safe:animate-pulse motion-reduce:animate-none"
        draggable={false}
        height={256}
        loading="eager"
        src={ARTWORK[variant]}
        unoptimized
        width={256}
      />
    </output>
  );
}
