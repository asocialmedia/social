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

// Codec probing happens after hydration. Browsers without AV1 decoding keep
// the compatible source; the proxy also falls back while modern work is queued.
export function useVideoDelivery(
  videoRef: RefObject<HTMLVideoElement | null>,
  mediaId: string | undefined,
  enabled: boolean,
  hasHls = false
) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaId || !enabled) {
      return;
    }
    const fallback = getMediaVariantUrl(mediaId, "mp4-h264.mp4");
    let destroyed = false;
    let hls: { destroy: () => void } | undefined;
    if (hasHls) {
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
            video.src = getMediaVariantUrl(mediaId, "hls/master.m3u8");
            return;
          }
          if (mode === "unsupported") {
            return;
          }
          const instance = new Hls({
            capLevelToPlayerSize: true,
            enableWorker: true,
            maxBufferLength: 8,
            maxBufferSize: 8 * 1024 * 1024,
            maxMaxBufferLength: 16,
            startLevel: -1,
          });
          hls = instance;
          const shouldResume = !video.paused;
          instance.on(Hls.Events.MANIFEST_PARSED, () => {
            if (shouldResume && !destroyed) {
              void resumeVideo(video);
            }
          });
          instance.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              instance.destroy();
              const wasPlaying = !video.paused;
              video.src = fallback;
              if (wasPlaying || shouldResume) {
                void resumeVideo(video);
              }
            }
          });
          instance.attachMedia(video);
          instance.loadSource(getMediaVariantUrl(mediaId, "hls/master.m3u8"));
        } catch {
          // The progressive source stays available if loading HLS fails.
        }
      })();
    } else if (video.canPlayType('video/webm; codecs="av01.0.08M.08,opus"')) {
      video.src = getMediaVariantUrl(mediaId, "webm-av1.webm");
    }
    return () => {
      destroyed = true;
      hls?.destroy();
    };
  }, [enabled, hasHls, mediaId, videoRef]);
}
