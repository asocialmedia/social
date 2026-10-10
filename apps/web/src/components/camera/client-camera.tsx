"use client";

// Full-screen web capture page. Live preview via getUserMedia (front by
// default, requested only on mount), tracks stopped on unmount so nothing
// leaks after close. Tap the orange shutter for a photo, press-and-hold for
// video (MediaRecorder, manual stop, no cap). Captures feed the floating
// composer with the selected fleet / gust / community target. File picker is
// the fallback when no camera exists and the gallery entry point otherwise.
import { clientLog } from "@asm/config/debug";
import { Images, RefreshCw, X, Zap, ZapOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useComposerAttachmentStore } from "@/components/posts/editor/attachment-store";
import { cn } from "@/lib/utils";
import { useActiveCommunityStore } from "@/store/active-community-store";
import { useComposerStore } from "@/store/composer-store";

import {
  CAMERA_TARGETS,
  composerModeForTarget,
  targetAllowsKind,
} from "./camera-target";
import type { CameraTarget } from "./camera-target";

type Facing = "environment" | "user";

const TARGET_LABEL: Record<CameraTarget, string> = {
  community: "Community",
  fleet: "Fleet",
  gust: "Gusts",
};

export default function ClientCamera() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const holdTimer = useRef<number | null>(null);
  const holdFired = useRef(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [facing, setFacing] = useState<Facing>("user");
  const [flash, setFlash] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [target, setTarget] = useState<CameraTarget>("fleet");
  const [status, setStatus] = useState<
    "denied" | "loading" | "ready" | "unsupported"
  >("loading");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [lastThumb, setLastThumb] = useState<string | null>(null);
  const openComposer = useComposerStore((s) => s.openComposer);
  const openInCommunity = useComposerStore((s) => s.openComposerInCommunity);
  const setMode = useComposerStore((s) => s.setMode);
  const startUpload = useComposerAttachmentStore((s) => s.startUpload);
  const community = useActiveCommunityStore((s) => s.community);
  const canPost = useActiveCommunityStore((s) => s.canPost);

  const stopStream = useCallback(() => {
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch {
      // Already stopped.
    }
    recorderRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {
        // Track already ended.
      }
    }
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startStream = useCallback(
    async (nextFacing: Facing) => {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        setStatus("unsupported");
        return;
      }
      setStatus("loading");
      setCameraError(null);
      stopStream();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { facingMode: { ideal: nextFacing } },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch {
            // Autoplay waits for a user gesture, the preview still renders.
          }
        }
        // Torch support is per-track: probe once per stream, flash stays off
        // when the device has no torch (most front cameras).
        const [track] = stream.getVideoTracks();
        const caps = track?.getCapabilities?.() as
          | { torch?: boolean }
          | undefined;
        setTorchSupported(Boolean(caps?.torch));
        setFlash(false);
        setStatus("ready");
        clientLog.info("camera.stream_ready");
      } catch (error) {
        const name = error instanceof Error ? error.name : "UnknownError";
        clientLog.error("camera.stream_failed:", error);
        if (name === "NotAllowedError" || name === "SecurityError") {
          setStatus("denied");
          setCameraError(
            "Camera access was blocked. Allow it to capture, or pick a file instead."
          );
        } else if (
          name === "NotFoundError" ||
          name === "OverconstrainedError"
        ) {
          setStatus("unsupported");
          setCameraError(
            "No camera found on this device. The file picker still works."
          );
        } else {
          setStatus("denied");
          setCameraError(
            error instanceof Error ? error.message : "Camera unavailable."
          );
        }
      }
    },
    [stopStream]
  );

  // Requested only here, never before open. Cleanup stops every track so the
  // indicator dies the moment the page closes or the tab hides.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- effect syncs with camera hardware, the external system
    void startStream("user");
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        stopStream();
      }
    };
    const onPageHide = () => stopStream();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      stopStream();
    };
  }, [startStream, stopStream]);

  const close = useCallback(() => {
    stopStream();
    router.back();
  }, [router, stopStream]);

  const flip = useCallback(() => {
    if (recording) {
      return;
    }
    const next: Facing = facing === "user" ? "environment" : "user";
    setFacing(next);
    clientLog.info("camera.flip");
    void startStream(next);
  }, [facing, recording, startStream]);

  const toggleFlash = useCallback(async () => {
    const [track] = streamRef.current?.getVideoTracks() ?? [];
    if (!track || !torchSupported) {
      return;
    }
    const next = !flash;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setFlash(next);
      clientLog.info("camera.flash");
    } catch (error) {
      clientLog.error("camera.flash_failed:", error);
    }
  }, [flash, torchSupported]);

  const deliver = useCallback(
    async (file: File, kind: "photo" | "video") => {
      const mode = composerModeForTarget(target);
      const effective =
        !targetAllowsKind(target, kind) && kind === "photo" ? "post" : mode;
      // Preview thumb for the gallery button (object URL, revoked on replace).
      setLastThumb((prev) => {
        if (prev?.startsWith("blob:")) {
          URL.revokeObjectURL(prev);
        }
        return kind === "photo" ? URL.createObjectURL(file) : prev;
      });
      if (target === "community" && community && canPost) {
        openInCommunity(community);
      } else {
        // Bare opens preserve the current mode, so force the capture target.
        setMode(effective);
        openComposer(effective);
      }
      await startUpload([file]);
      stopStream();
      router.back();
    },
    [
      canPost,
      community,
      openComposer,
      openInCommunity,
      router,
      setMode,
      startUpload,
      stopStream,
      target,
    ]
  );

  const takePhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video || status !== "ready" || capturing || recording) {
      return;
    }
    setCapturing(true);
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Canvas unavailable on this browser.");
      setCapturing(false);
      return;
    }
    // Mirror front-camera stills so they match the preview.
    if (facing === "user") {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, width, height);
    // oxlint-disable-next-line promise/avoid-new -- canvas.toBlob is callback-only, no async alternative exists
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (b) => {
          resolve(b);
        },
        "image/jpeg",
        0.92
      );
    });
    if (!blob) {
      setCameraError("Couldn't encode that photo.");
      setCapturing(false);
      return;
    }
    const file = new File([blob], `fleet-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });
    clientLog.info("camera.photo");
    await deliver(file, "photo");
    setCapturing(false);
  }, [capturing, deliver, facing, recording, status]);

  const startVideo = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || status !== "ready" || recording) {
      return;
    }
    try {
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        chunksRef.current = [];
        setRecording(false);
        if (blob.size === 0) {
          return;
        }
        const file = new File([blob], `gust-${Date.now()}.webm`, {
          type: "video/webm",
        });
        clientLog.info("camera.record_stop");
        void deliver(file, "video");
      };
      recorderRef.current = recorder;
      // No timeslice cap: manual stop on release.
      recorder.start();
      setRecording(true);
      clientLog.info("camera.record_start");
    } catch (error) {
      clientLog.error("camera.record_failed:", error);
    }
  }, [deliver, recording, status]);

  const stopVideo = useCallback(() => {
    try {
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
    } catch (error) {
      clientLog.error("camera.stop_failed:", error);
      setRecording(false);
    }
  }, []);

  const onShutterDown = useCallback(() => {
    holdFired.current = false;
    holdTimer.current = window.setTimeout(() => {
      holdFired.current = true;
      startVideo();
    }, 350);
  }, [startVideo]);

  const onShutterUp = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (recording) {
      stopVideo();
      return;
    }
    if (!holdFired.current) {
      void takePhoto();
    }
    holdFired.current = false;
  }, [recording, stopVideo, takePhoto]);

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) {
        return;
      }
      const kind = file.type.startsWith("video") ? "video" : "photo";
      void deliver(file, kind);
    },
    [deliver]
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <video
        autoPlay
        className={cn(
          "absolute inset-0 h-full w-full object-cover",
          facing === "user" && "-scale-x-100"
        )}
        muted
        playsInline
        ref={videoRef}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/60" />
      <div className="absolute top-0 right-0 left-0 z-10 flex items-start justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          aria-label="Close camera"
          className="rail-3d-btn flex h-10 w-10 items-center justify-center rounded-full"
          onClick={close}
          type="button"
        >
          <X className="size-5" />
        </button>
        <button
          aria-label={flash ? "Turn flash off" : "Turn flash on"}
          aria-pressed={flash}
          className={cn(
            "rail-3d-btn flex h-10 w-10 items-center justify-center rounded-full",
            flash && "rail-3d-btn-orange"
          )}
          disabled={!torchSupported || status !== "ready"}
          onClick={toggleFlash}
          title={
            torchSupported ? undefined : "Torch not available on this camera"
          }
          type="button"
        >
          {flash ? (
            <Zap className="size-[18px]" fill="currentColor" />
          ) : (
            <ZapOff className="size-[18px]" />
          )}
        </button>
      </div>
      {status === "loading" ? (
        <div className="relative z-10 flex flex-1 items-center justify-center">
          <p className="text-sm text-white/80">Warming up the camera…</p>
        </div>
      ) : null}
      {status !== "loading" && status !== "ready" ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-lg font-semibold">
            {status === "unsupported" ? "No camera here" : "Camera is off"}
          </p>
          <p className="text-sm text-white/75">
            {cameraError ?? "Nothing runs until you allow it."}
          </p>
          <div className="mt-2 flex items-center gap-2">
            {status === "denied" ? (
              <button
                className="follow-btn-3d rounded-full px-5 py-2.5 text-sm font-semibold"
                onClick={() => {
                  /* empty */
                }}
                type="button"
              >
                Try Again
              </button>
            ) : null}
            <button
              className="rail-3d-btn rounded-full px-5 py-2.5 text-sm"
              onClick={() => fileRef.current?.click()}
              type="button"
            >
              Open Files
            </button>
          </div>
        </div>
      ) : null}
      <div className="absolute right-0 bottom-0 left-0 z-10 flex flex-col items-center gap-4">
        <button
          aria-label={
            recording
              ? "Release to stop recording"
              : "Take photo, hold for video"
          }
          className="group relative flex size-[96px] items-center justify-center rounded-full transition-transform active:scale-95"
          onPointerDown={onShutterDown}
          onPointerLeave={() => {
            if (recording) {
              stopVideo();
            }
          }}
          onPointerUp={onShutterUp}
          type="button"
        >
          <span className="flex size-[82px] items-center justify-center rounded-full bg-[#0b0b0b] shadow-[inset_0_2px_5px_rgba(0,0,0,0.8),inset_0_-1px_2px_rgba(255,255,255,0.1)]">
            <span
              className={cn(
                "flex items-center justify-center rounded-full border transition-all duration-150",
                recording
                  ? "size-[70px] border-black/25 bg-red-500 shadow-[inset_0_-3px_6px_rgba(0,0,0,0.35),inset_0_3px_5px_rgba(255,255,255,0.35),0_1px_4px_rgba(255,59,48,0.6)]"
                  : "size-[70px] border-black/15 bg-white shadow-[inset_0_-2px_3px_rgba(0,0,0,0.18),inset_0_2px_2px_rgba(255,255,255,0.9),0_1px_2px_rgba(0,0,0,0.3)]"
              )}
            >
              {capturing && !recording ? (
                <span className="size-5 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" />
              ) : null}
            </span>
          </span>
          {recording ? (
            <svg
              aria-hidden
              className="absolute inset-0 animate-spin"
              fill="none"
              style={{ animationDuration: "1.1s" }}
              viewBox="0 0 104 104"
            >
              <circle
                cx="52"
                cy="52"
                r="50"
                stroke="#ff453a"
                strokeDasharray="88 314"
                strokeLinecap="round"
                strokeWidth="4"
              />
            </svg>
          ) : null}
        </button>
        {recording ? (
          <p className="text-xs text-white/85">Release to stop</p>
        ) : null}
        <div className="flex w-full items-center justify-between px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="flex w-14 items-center justify-center">
            <button
              aria-label="Open gallery"
              className="flex size-10 items-center justify-center overflow-hidden rounded-[10px] border border-white/20 bg-white/10"
              onClick={() => fileRef.current?.click()}
              type="button"
            >
              {lastThumb ? (
                // oxlint-disable-next-line next/no-img-element -- blob preview URL, next/image cannot optimize object URLs
                <img
                  alt=""
                  className="h-full w-full object-cover"
                  src={lastThumb}
                />
              ) : (
                <Images className="size-4.5 text-white/90" />
              )}
            </button>
          </div>
          <div
            className="flex flex-1 items-center justify-center gap-7"
            role="tablist"
            aria-label="Post target"
          >
            {CAMERA_TARGETS.map((item) => {
              const active = item === target;
              return (
                <button
                  aria-selected={active}
                  className={cn(
                    "px-1 py-2 text-sm",
                    active
                      ? "font-bold text-white"
                      : "font-medium text-white/55"
                  )}
                  key={item}
                  onClick={() => setTarget(item)}
                  role="tab"
                  type="button"
                >
                  {TARGET_LABEL[item]}
                </button>
              );
            })}
          </div>
          <div className="flex w-14 items-center justify-center">
            <button
              aria-label="Flip camera"
              className="rail-3d-btn flex size-10 items-center justify-center rounded-full"
              disabled={recording}
              onClick={flip}
              type="button"
            >
              <RefreshCw className="size-4.5" />
            </button>
          </div>
        </div>
        <input
          accept="image/*,video/*,.png,.jpg,.jpeg,.gif,.mp4,.mov,.webm"
          aria-label="Choose from files"
          className="sr-only"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
          ref={fileRef}
          type="file"
        />
      </div>
    </div>
  );
}
