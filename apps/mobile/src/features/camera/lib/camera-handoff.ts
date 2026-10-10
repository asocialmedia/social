// Pure helpers for the camera -> composer handoff, kept side-effect free so they stay unit-testable.
// The screen itself owns permissions, capture, saving, and navigation.
import type { PickedMedia } from "@/features/media-upload/state/attachment-store";

export type CameraTarget = "community" | "fleet" | "gust";
export type CameraComposerMode = "gust" | "post";

export const CAMERA_TARGETS: CameraTarget[] = ["fleet", "gust", "community"];

// Fleet and community both compose as fleets, gusts compose as gusts.
// Community scoping rides on the existing draft communityId, so the camera
// never invents its own community picker here.
export function composerModeForTarget(
  target: CameraTarget
): CameraComposerMode {
  return target === "gust" ? "gust" : "post";
}

function basename(uri: string): string {
  const tail = uri.split("/").pop() ?? "";
  return tail.split("?")[0] || "capture";
}

function withExtension(name: string, fallback: string): string {
  if (name.includes(".")) {
    return name;
  }
  return `${name}.${fallback}`;
}

// Build the attachment-store payload for a fresh capture.
// Photo -> image/jpeg, video -> video/mp4, matching the pick-media gate.
export function pickedFromCapture(
  uri: string,
  kind: "photo" | "video",
  extra?: { height?: number; width?: number }
): PickedMedia {
  const stamp = Date.now().toString(36);
  if (kind === "video") {
    const name = withExtension(basename(uri) || `gust-${stamp}`, "mp4");
    return {
      durationMs: null,
      height: extra?.height,
      mimeType: "video/mp4",
      name,
      size: 0,
      uri,
      width: extra?.width,
    };
  }
  const name = withExtension(basename(uri) || `fleet-${stamp}`, "jpg");
  return {
    durationMs: null,
    height: extra?.height,
    mimeType: "image/jpeg",
    name,
    size: 0,
    uri,
    width: extra?.width,
  };
}

// Gusts require video, fleets accept either. Used to nudge the target when a
// photo lands while gust is selected, instead of failing the publish later.
export function targetAllowsKind(
  target: CameraTarget,
  kind: "photo" | "video"
): boolean {
  if (target === "gust") {
    return kind === "video";
  }
  return true;
}
