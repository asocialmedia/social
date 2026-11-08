"use client";

import { useRef } from "react";

import { useVideoDelivery } from "@/lib/media/use-video-delivery";
import { getMediaVideoUrl } from "@/lib/utils/image-url";

export function WatchVideoPlayer({
  mediaId,
  title,
  hasHls = false,
  hasCaptions = false,
}: {
  mediaId: string;
  title: string;
  hasHls?: boolean;
  hasCaptions?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoDelivery(videoRef, mediaId, true, hasHls);
  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption -- expose real captions only when the source video supplies them.
    <video
      aria-label={title}
      className="max-h-[75dvh] min-h-64 w-full rounded-2xl bg-black"
      controls
      playsInline
      preload="metadata"
      poster={`/api/media/${mediaId}?thumb=1`}
      ref={videoRef}
      src={getMediaVideoUrl(mediaId)}
    >
      {hasCaptions ? (
        <track
          kind="captions"
          label="Captions"
          src={`/api/media/${mediaId}?captions=1`}
        />
      ) : null}
    </video>
  );
}
