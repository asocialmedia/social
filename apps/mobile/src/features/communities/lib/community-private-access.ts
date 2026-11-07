// The copy and branching of web's `community-private-landing.tsx`, kept pure so
// the screen only renders what this resolves and the rules can be tested
// without a renderer.
import type { CommunityPreview } from "./communities-api";

// Web polls the preview this often while a request waits on a moderator.
export const PENDING_PREVIEW_POLL_MS = 30_000;

export type PrivateLandingMode = "banned" | "pending" | "request";

export interface PrivateLandingView {
  cancelLabel: string;
  description: string;
  mode: PrivateLandingMode;
  requestLabel: string;
}

export const PRIVATE_LANDING_REFRESH_ERROR =
  "Couldn't refresh your membership. Try again.";

export function privateLandingMode(
  preview: CommunityPreview | null
): PrivateLandingMode {
  if (preview?.permissions.banned) {
    return "banned";
  }
  if (preview?.membership?.status === "PENDING") {
    return "pending";
  }
  return "request";
}

export function privateLandingView({
  busy,
  isLoggedIn,
  preview,
}: {
  busy: boolean;
  isLoggedIn: boolean;
  preview: CommunityPreview | null;
}): PrivateLandingView {
  const mode = privateLandingMode(preview);
  let description =
    "Join to read posts and take part in community chat. The owner or a moderator reviews each request.";
  if (mode === "banned") {
    description = "You cannot request access to this community.";
  } else if (mode === "pending") {
    description =
      "The owner or a moderator will review your request. Once approved, you can read posts and join community chat.";
  }
  let requestLabel = isLoggedIn
    ? "Request to join"
    : "Sign in to request access";
  if (busy) {
    requestLabel = "Sending…";
  }
  return {
    cancelLabel: busy ? "Cancelling…" : "Cancel request",
    description,
    mode,
    requestLabel,
  };
}

// Null stops the poll. Only a waiting request is worth re-reading on a timer;
// every other state changes only through the viewer's own action.
export function previewPollInterval(
  preview: CommunityPreview | null
): number | null {
  return preview?.membership?.status === "PENDING"
    ? PENDING_PREVIEW_POLL_MS
    : null;
}
