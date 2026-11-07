// Per-button lock reasons for the composer toolbar, ported from web's
// mediaLockReason / gifLockReason / audioLockReason in post-editor.tsx (they
// ride the disabled buttons' title tooltips). Native has no hover tooltips,
// so the reasons surface as toasts when a locked control is tapped, plus an
// accessibility hint for screen readers. Pure for tests.
import { MAX_POST_ATTACHMENTS } from "@asm/media";

export type MediaButtonKind = "audio" | "gif" | "photos";

export interface MediaLockState {
  attachmentCount: number;
  capacityFull: boolean;
  hasAudio: boolean;
  hasGif: boolean;
  hasVideo: boolean;
  isGust: boolean;
}

// The reason a toolbar button is locked, or null when it may open its
// picker. Gust-with-video is a hard hide on web (pickers disappear; the tile
// replaces the clip), so it reports no reason and stays fully disabled.
export function mediaLockReason(
  kind: MediaButtonKind,
  state: MediaLockState
): string | null {
  if (kind === "photos") {
    if (state.isGust && state.hasVideo) {
      return null;
    }
    if (state.capacityFull) {
      return `Posts hold up to ${MAX_POST_ATTACHMENTS} attachments.`;
    }
    if (state.hasAudio) {
      return "Audio is attached - remove it to add other media";
    }
    if (state.hasGif) {
      return "A GIF is attached - remove it to add other media";
    }
    return null;
  }
  if (state.attachmentCount === 0) {
    return null;
  }
  if (kind === "gif") {
    if (state.hasAudio) {
      return "Audio is attached - remove it to add GIFs";
    }
    if (state.hasGif) {
      return "A GIF is already attached";
    }
    return "Remove the current media to add GIFs";
  }
  if (state.hasAudio) {
    return "Audio is already attached";
  }
  if (state.hasGif) {
    return "A GIF is attached - remove it to add audio";
  }
  return "Remove the current media to add audio";
}
