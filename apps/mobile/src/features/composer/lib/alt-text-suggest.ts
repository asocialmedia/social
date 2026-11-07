// Alt-text auto-generate outcome matrix, ported from web's
// handleAutoAltText in alt-text-panel.tsx: every analysis outcome tells the
// writer what happened instead of failing silently. Pure (toast copy +
// outcome classification) so the fleet panel and the gust dock share one
// matrix, covered by tests.
import { HttpError } from "@/features/media-upload/lib/retry";

export const ALT_TEXT_MAX_LENGTH = 1000;

export type AltSuggestOutcome =
  | { kind: "auth" }
  | { kind: "missing" }
  | { kind: "network" }
  | { kind: "no-text" }
  | { kind: "processing" }
  | { kind: "stale" }
  | { kind: "success"; suggestion: string };

export function classifyAltSuggest(input: {
  error?: unknown;
  result?: { isProcessing?: boolean; suggestedAlt?: string };
}): AltSuggestOutcome {
  if (input.result) {
    if (input.result.suggestedAlt) {
      return {
        kind: "success",
        suggestion: input.result.suggestedAlt.slice(0, ALT_TEXT_MAX_LENGTH),
      };
    }
    return input.result.isProcessing
      ? { kind: "processing" }
      : { kind: "no-text" };
  }
  if (input.error === undefined) {
    return { kind: "missing" };
  }
  const status = input.error instanceof HttpError ? input.error.status : null;
  switch (status) {
    case 401: {
      return { kind: "auth" };
    }
    case 404: {
      return { kind: "stale" };
    }
    case null: {
      return { kind: "network" };
    }
    default: {
      return { kind: "processing" };
    }
  }
}

// Web's exact toast copy per outcome (all default-variant toasts).
export function altSuggestToastCopy(outcome: AltSuggestOutcome): {
  description?: string;
  title: string;
} {
  switch (outcome.kind) {
    case "auth": {
      return {
        description: "Your session expired. Please sign in again.",
        title: "Authentication required",
      };
    }
    case "missing": {
      return {
        description:
          "Please wait until the media finishes uploading to generate alt text.",
        title: "Media upload in progress",
      };
    }
    case "network": {
      return {
        description: "Network error while fetching media analysis.",
        title: "Could not generate alt text",
      };
    }
    case "no-text": {
      return {
        description: "No spoken speech or text was detected in this media.",
        title: "No text detected",
      };
    }
    case "processing": {
      return {
        description:
          "Media is still being transcribed and analyzed in the background. Please try again in a few moments.",
        title: "Analysis in progress",
      };
    }
    case "stale": {
      return {
        description: "This media is no longer available.",
        title: "Media unavailable",
      };
    }
    case "success": {
      return { title: "Alt text generated from media analysis" };
    }
    default: {
      return { title: "Could not generate alt text" };
    }
  }
}
