"use client";

import { clientLog } from "@asm/config/debug";
import { Images, RefreshCw, X, Zap, ZapOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useComposerAttachmentStore } from "@/components/posts/editor/attachment-store";
import { cn } from "@/lib/utils";
import { useActiveCommunityStore } from "@/store/active-community-store";
import { useComposerStore } from "@/store/composer-store";

// Full-screen web capture page. Live preview via getUserMedia (front by
// default, requested only on mount), tracks stopped on unmount so nothing
// leaks after close. Tap the orange shutter for a photo, press-and-hold for
// video (MediaRecorder, manual stop, no cap). Captures feed the floating
// composer with the selected fleet / gust / community target. File picker is
// the fallback when no camera exists and the gallery entry point otherwise.
import {
  capturePhoto,
  recordingMimeType,
  saveCameraDownload,
} from "./camera-capture";
import {
  CAMERA_TARGETS,
  composerModeForTarget,
  targetAllowsKind,
} from "./camera-target";
import type { CameraTarget } from "./camera-target";

type Facing = "environment" | "user";

const TARGET_LABEL: Record<CameraTarget, string> = {
  community: "Communities",
  fleet: "Fleets",
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
  const [recordSeconds, setRecordSeconds] = useState(0);
  const captureBusy = useRef(false);
  const deliverRecording = useRef(false);
  const streamRequest = useRef(0);
  const active = useRef(true);
  useEffect(() => {
    if (!recording) {
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(
      () => setRecordSeconds(Math.floor((Date.now() - started) / 1000)),
      250
    );
    return () => window.clearInterval(timer);
  }, [recording]);
  const [capturing, setCapturing] = useState(false);

  const openComposer = useComposerStore((s) => s.openComposer);
  const openInCommunity = useComposerStore((s) => s.openComposerInCommunity);
  const setMode = useComposerStore((s) => s.setMode);
  const startUpload = useComposerAttachmentStore((s) => s.startUpload);
  const community = useActiveCommunityStore((s) => s.community);
  const canPost = useActiveCommunityStore((s) => s.canPost);

  const stopStream = useCallback(() => {
    streamRequest.current += 1;
    deliverRecording.current = false;
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
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
      streamRequest.current += 1;
      const request = streamRequest.current;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { facingMode: { ideal: nextFacing } },
        });
        if (!active.current || request !== streamRequest.current) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          return;
        }
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
    active.current = true;
    // oxlint-disable-next-line react/set-state-in-effect -- effect syncs with camera hardware, the external system
    void startStream(facing);
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        stopStream();
      } else {
        void startStream(facing);
      }
    };
    const onPageHide = () => stopStream();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      active.current = false;
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      stopStream();
    };
  }, [facing, startStream, stopStream]);

  const close = useCallback(() => {
    stopStream();
    router.back();
  }, [router, stopStream]);

  const flip = useCallback(() => {
    if (recording || capturing || captureBusy.current) {
      return;
    }
    const next: Facing = facing === "user" ? "environment" : "user";
    setFacing(next);
    clientLog.info("camera.flip");
  }, [facing, recording, capturing]);

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
    if (
      !video ||
      status !== "ready" ||
      capturing ||
      recording ||
      captureBusy.current
    ) {
      return;
    }
    captureBusy.current = true;
    setCapturing(true);
    setCameraError(null);
    try {
      const file = await capturePhoto(video, facing === "user");
      clientLog.info("camera.photo");
      saveCameraDownload(file);
      if (active.current) {
        await deliver(file, "photo");
      }
    } catch (error) {
      clientLog.error("camera.photo_failed:", error);
      setCameraError("Couldn't finish that capture. Try again.");
    }
    captureBusy.current = false;
    if (active.current) {
      setCapturing(false);
    }
  }, [capturing, deliver, facing, recording, status]);

  const finishVideo = useCallback(
    async (file: File) => {
      try {
        saveCameraDownload(file);
        await deliver(file, "video");
      } catch (error) {
        clientLog.error("camera.handoff_failed:", error);
        if (active.current) {
          setCameraError(
            "Video saved to Downloads. Couldn't attach it; choose it from files to retry."
          );
        }
      }
      captureBusy.current = false;
      if (active.current) {
        setCapturing(false);
      }
    },
    [deliver]
  );

  const startVideo = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || status !== "ready" || recording || captureBusy.current) {
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setCameraError(
        "Video recording isn't supported by this browser. You can choose a video from files."
      );
      return;
    }
    try {
      const mime = recordingMimeType((type) =>
        MediaRecorder.isTypeSupported(type)
      );
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined
      );
      captureBusy.current = true;
      deliverRecording.current = true;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.addEventListener("error", () => {
        deliverRecording.current = false;
        captureBusy.current = false;
        if (active.current) {
          setRecording(false);
          setCapturing(false);
          setCameraError(
            "Recording interrupted. Hold the shutter to try again."
          );
        }
      });
      recorder.onstop = () => {
        const type = recorder.mimeType || mime || "video/webm";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        recorderRef.current = null;
        if (!deliverRecording.current || !active.current) {
          captureBusy.current = false;
          return;
        }
        deliverRecording.current = false;
        setRecording(false);
        setCapturing(true);
        if (blob.size === 0) {
          captureBusy.current = false;
          setCapturing(false);
          setCameraError(
            "No video was recorded. Hold the shutter a little longer."
          );
          return;
        }
        const file = new File(
          [blob],
          `gust-${Date.now()}.${type.startsWith("video/mp4") ? "mp4" : "webm"}`,
          { type }
        );
        void finishVideo(file);
      };
      recorderRef.current = recorder;
      // No timeslice cap: manual stop on release.
      recorder.start();
      setRecordSeconds(0);
      setCameraError(null);
      setRecording(true);
      clientLog.info("camera.record_start");
    } catch (error) {
      captureBusy.current = false;
      setCameraError(
        error instanceof Error ? error.message : "Couldn't start recording."
      );
      clientLog.error("camera.record_failed:", error);
    }
  }, [finishVideo, recording, status]);

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
    if (recorderRef.current?.state === "recording") {
      stopVideo();
      return;
    }
    if (!holdFired.current) {
      void takePhoto();
    }
    holdFired.current = false;
  }, [stopVideo, takePhoto]);

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

  let captureStatus = "Tap for photo · Hold for video";
  if (capturing) {
    captureStatus = "Saving capture…";
  }
  if (recording) {
    captureStatus = `● ${Math.floor(recordSeconds / 60)
      .toString()
      .padStart(
        2,
        "0"
      )}:${(recordSeconds % 60).toString().padStart(2, "0")} · Release to stop`;
  }
  if (cameraError && status === "ready") {
    captureStatus = cameraError;
  }

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
                  void startStream(facing);
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
      <div className="absolute right-0 bottom-0 left-0 z-10 flex flex-col items-center gap-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <output className="flex min-h-6 items-center justify-center px-6 text-center text-xs text-white/90 tabular-nums">
          {captureStatus}
        </output>
        <div className="grid w-full grid-cols-[56px_1fr_56px] items-center justify-items-center px-5">
          <button
            aria-label="Open gallery"
            className="rail-3d-btn flex size-8.5 items-center justify-center overflow-hidden rounded-[10px]"
            disabled={capturing || recording}
            onClick={() => fileRef.current?.click()}
            type="button"
          >
            <Images className="size-4 text-white/90" />
          </button>
          <button
            aria-label={
              recording
                ? "Release to stop recording"
                : "Take photo, hold for video"
            }
            disabled={capturing || status !== "ready"}
            className="relative flex size-24 touch-none items-center justify-center rounded-full transition-transform active:scale-95 disabled:opacity-60"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              onShutterDown();
            }}
            onPointerUp={onShutterUp}
            onPointerCancel={() => {
              if (holdTimer.current !== null) {
                window.clearTimeout(holdTimer.current);
              }
              holdTimer.current = null;
              holdFired.current = false;
              stopVideo();
            }}
            onClick={(event) => {
              if (event.detail === 0) {
                void takePhoto();
              }
            }}
            type="button"
          >
            <span className="flex size-[82px] items-center justify-center">
              <span className="btn-3d flex size-[70px] items-center justify-center rounded-full!">
                {recording ? (
                  <span className="size-6 rounded-md bg-white shadow-sm" />
                ) : null}
                {capturing && !recording ? (
                  <span className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : null}
              </span>
            </span>
            {recording ? (
              <svg
                aria-hidden
                className="pointer-events-none absolute -inset-1 size-[104px] animate-spin motion-reduce:animate-none"
                fill="none"
                style={{ animationDuration: "2s" }}
                viewBox="0 0 104 104"
              >
                <circle
                  cx="52"
                  cy="52"
                  r="50"
                  stroke="#ff9500"
                  strokeDasharray="88 314"
                  strokeLinecap="round"
                  strokeWidth="3"
                />
              </svg>
            ) : null}
          </button>
          <button
            aria-label="Flip camera"
            className="rail-3d-btn flex size-10 items-center justify-center rounded-full"
            disabled={recording || capturing || status !== "ready"}
            onClick={flip}
            type="button"
          >
            <RefreshCw className="size-4.5" />
          </button>
        </div>
        <div
          className="flex items-center justify-center gap-6"
          role="tablist"
          aria-label="Post target"
        >
          {CAMERA_TARGETS.map((item) => (
            <button
              aria-selected={item === target}
              className={cn(
                "relative px-1 py-3 text-sm",
                item === target
                  ? "font-bold text-white"
                  : "font-medium text-white/55"
              )}
              disabled={recording || capturing}
              key={item}
              onClick={() => setTarget(item)}
              role="tab"
              type="button"
            >
              {TARGET_LABEL[item]}
              {item === target ? (
                <span
                  aria-hidden
                  className="absolute bottom-0.5 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-[#ff9500]"
                />
              ) : null}
            </button>
          ))}
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
