// Shared camera -> composer target. Fleet and community compose as fleets,
// gusts compose as gusts. Community scoping rides on the active community
// store, so the camera never invents its own picker here.
export type CameraTarget = "community" | "fleet" | "gust";

export const CAMERA_TARGETS: CameraTarget[] = ["fleet", "gust", "community"];

export function composerModeForTarget(target: CameraTarget): "gust" | "post" {
  return target === "gust" ? "gust" : "post";
}

export function targetAllowsKind(
  target: CameraTarget,
  kind: "photo" | "video"
): boolean {
  if (target === "gust") {
    return kind === "video";
  }
  return true;
}
