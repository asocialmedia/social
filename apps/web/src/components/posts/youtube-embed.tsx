"use client";

import { useState } from "react";

import type { LinkEmbed } from "@/lib/link-embeds/shared";

import { embedImageProxyUrl, useEmbedImageError } from "./embed-utils";

// YouTube preview: a click-to-play facade (thumbnail + play button) that
// swaps to the youtube-nocookie player on demand. Nothing from Google loads
// until the viewer opts in, and the video id is validated server-side
// against the strict 11-char base64url alphabet, so the iframe src is
// always exactly /embed/<id>.

const YOUTUBE_ID_SAFE = /^[A-Za-z0-9_-]{11}$/;

export function YouTubeEmbed({ embed }: { embed: LinkEmbed }) {
  const [playing, setPlaying] = useState(false);
  const videoId = embed.videoId ?? "";
  const idSafe = YOUTUBE_ID_SAFE.test(videoId);
  const thumbnail = idSafe
    ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    : null;
  const image = useEmbedImageError(thumbnail);

  if (!idSafe) {
    return null;
  }

  return (
    <div className="embed-panel-3d group overflow-hidden">
      <a
        className="flex items-center gap-1.5 p-3 pb-2"
        href={embed.url}
        onClick={(event) => event.stopPropagation()}
        rel="nofollow ugc noopener noreferrer"
        target="_blank"
      >
        <span className="flex h-4 w-6 shrink-0 items-center justify-center rounded-sm bg-[#ff0000]">
          <span className="-mr-px size-0 border-y-[4px] border-l-[7px] border-white border-y-transparent" />
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {embed.videoAuthor ?? embed.siteName ?? "YouTube"}
        </span>
      </a>
      <div className="relative aspect-video w-full bg-black">
        {playing ? (
          // oxlint-disable-next-line react/iframe-missing-sandbox -- the YouTube player requires scripts; the embed is same-scheme youtube-nocookie with a server-validated 11-char id
          <iframe
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="absolute inset-0 size-full"
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
            title={embed.title}
          />
        ) : (
          <button
            aria-label={`Play video: ${embed.title}`}
            className="absolute inset-0 size-full cursor-pointer"
            onClick={(event) => {
              event.stopPropagation();
              setPlaying(true);
            }}
            type="button"
          >
            {thumbnail && !image.failed ? (
              // eslint-disable-next-line @next/next/no-img-element -- proxy/CDN origin, optimizer rejects these paths
              <img
                alt=""
                className="size-full object-cover"
                loading="lazy"
                onError={image.handleError}
                referrerPolicy="no-referrer"
                src={embedImageProxyUrl(thumbnail)}
              />
            ) : null}
            <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors duration-150 group-hover:bg-black/15">
              <span className="flex size-14 items-center justify-center rounded-full bg-black/70 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_2px_6px_rgba(0,0,0,0.4)] transition-transform duration-150 group-hover:scale-105">
                <span className="ml-1 size-0 border-y-[11px] border-l-[18px] border-white/95 border-y-transparent" />
              </span>
            </span>
          </button>
        )}
      </div>
      <p className="text-foreground px-3 py-2 text-sm font-medium">
        {embed.title}
      </p>
    </div>
  );
}
