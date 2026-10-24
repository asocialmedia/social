"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

import { getMediaVariantUrl } from "@/lib/utils/image-url";

import { hlsPlaybackMode } from "./hls-playback";

async function resumeVideo(video: HTMLVideoElement) {
  try {
    await video.play();
  } catch {
    // Playback waits for the next user gesture when the browser requires it.
  }
}

async function loadHls() {
  return await import("hls.js");
}

export async function preloadVideoDelivery() {
  await loadHls().catch(() => null);
}

// Codec probing happens after hydration. Browsers without AV1 decoding keep
// the compatible source; the proxy also falls back while modern work is queued.
export function useVideoDelivery(
  videoRef: RefObject<HTMLVideoElement | null>,
  mediaId: string | undefined,
  enabled: boolean,
  hasHls = false,
  playbackIntent?: RefObject<boolean>,
  externalPlaylist?: string
) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || (!mediaId && !externalPlaylist) || !enabled) {
      return;
    }
    const fallback = externalPlaylist
      ? undefined
      : getMediaVariantUrl(mediaId ?? "", "mp4-h264.mp4");
    const playlist =
      externalPlaylist ?? getMediaVariantUrl(mediaId ?? "", "hls/master.m3u8");
    let destroyed = false;
    let hls: { destroy: () => void } | undefined;
    const shouldResume = () =>
      !destroyed && (playbackIntent ? playbackIntent.current : !video.paused);
    if (hasHls || externalPlaylist) {
      void (async () => {
        try {
          const { default: Hls } = await loadHls();
          if (destroyed) {
            return;
          }
          const mode = hlsPlaybackMode(
            Hls.isSupported(),
            Boolean(video.canPlayType("application/vnd.apple.mpegurl"))
          );
          if (mode === "native") {
            video.src = playlist;
            if (shouldResume()) {
              void resumeVideo(video);
            }
            return;
          }
          if (mode === "unsupported") {
            return;
          }
          const instance = new Hls({
            capLevelToPlayerSize: true,
            enableWorker: true,
            maxBufferLength: 4,
            maxBufferSize: 4 * 1024 * 1024,
            maxMaxBufferLength: 8,
            startFragPrefetch: true,
            startLevel: 0,
          });
          hls = instance;
          instance.on(Hls.Events.MANIFEST_PARSED, () => {
            if (shouldResume()) {
              void resumeVideo(video);
            }
          });
          instance.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              instance.destroy();
              const wasPlaying = !video.paused;
              if (!fallback || destroyed) {
                return;
              }
              video.src = fallback;
              if (!destroyed && (wasPlaying || shouldResume())) {
                void resumeVideo(video);
              }
            }
          });
          instance.loadSource(playlist);
          instance.attachMedia(video);
        } catch {
          // The progressive source stays available if loading HLS fails.
        }
      })();
    } else if (video.canPlayType('video/webm; codecs="av01.0.08M.08,opus"')) {
      video.src = getMediaVariantUrl(mediaId ?? "", "webm-av1.webm");
    }
    return () => {
      destroyed = true;
      hls?.destroy();
    };
  }, [enabled, externalPlaylist, hasHls, mediaId, playbackIntent, videoRef]);
}
