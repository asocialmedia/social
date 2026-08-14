"use client";

import type { Media } from "@asm/db";
import noMediaImage from "@assets/general/nomedia.png";
import Image from "next/image";
import { useCallback, useState } from "react";

import { cn, isGifUrl } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

const getMediaUrl = (mediaId: string) => `/api/media/${mediaId}`;

interface CommentMediaProps {
  media: Media;
}

// A single attachment inside an eddy. Images and videos render inline; any
// failure to load falls back to the nomedia placeholder with a short error
// message so a broken attachment never leaves an empty hole in the thread.
export function CommentMedia({ media }: CommentMediaProps) {
  const [failed, setFailed] = useState(false);

  const handleError = useCallback(() => {
    setFailed(true);
  }, []);

  if (failed) {
    return (
      <div className="border-border/60 bg-muted/30 text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
        <Image
          alt=""
          className="h-6 w-6 rounded object-contain opacity-70"
          height={24}
          src={noMediaImage}
          width={24}
        />
        <span>This attachment couldn't load.</span>
      </div>
    );
  }

  if (media.type === "VIDEO" || media.mimeType.startsWith("video/")) {
    return (
      <div className="mt-2 max-w-sm">
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- user-uploaded videos may not carry captions */}
        <video
          className="max-h-72 w-full rounded-lg object-contain"
          controls
          onError={handleError}
          playsInline
          poster={getMediaProxyUrl(media)}
          preload="metadata"
          src={getMediaUrl(media.id)}
        />
      </div>
    );
  }

  return (
    <div className="mt-2 max-w-sm">
      <div className="relative overflow-hidden rounded-lg">
        <Image
          alt="Attachment"
          className="max-h-72 w-auto rounded-lg object-contain"
          height={0}
          onError={handleError}
          sizes="(max-width: 640px) 100vw, 384px"
          src={getMediaUrl(media.id)}
          style={{ height: "auto" }}
          unoptimized
          width={0}
        />
      </div>
    </div>
  );
}

interface CommentAttachmentsProps {
  attachments: Media[];
  className?: string;
}

export function CommentAttachments({
  attachments,
  className,
}: CommentAttachmentsProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "mt-1.5 flex flex-wrap gap-2",
        attachments.length > 1 && "max-w-md",
        className
      )}
    >
      {attachments.map((media) => (
        <CommentMedia key={media.id} media={media} />
      ))}
    </div>
  );
}

// Avatar with an error fallback to the nomedia placeholder. Used when an
// eddy's author image fails to load (or is missing) so the thread never shows
// a broken image tile.
export function CommentAvatarFallback({
  className,
  src,
}: {
  className?: string;
  src?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const resolved = failed || !src ? noMediaImage.src : src;

  return (
    <Image
      alt=""
      className={cn(
        "avatar-ring aspect-square flex-none rounded-xl bg-gradient-to-b from-[hsl(var(--muted))] to-[hsl(var(--background-alt))] object-cover",
        className
      )}
      height={40}
      onError={() => setFailed(true)}
      src={resolved}
      unoptimized={isGifUrl(src)}
      width={40}
    />
  );
}
