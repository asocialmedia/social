// Link preview embeds for the feed, ported from web's link-embeds suite
// (lib/link-embeds/shared validation + posts/embeds cards). Payloads are
// resolved and validated server-side at publish time and stored on the post
// row; mobile only renders trusted data. No React Native imports: pure and
// unit-testable on Node.

export const MAX_POST_EMBEDS = 5;

// A resolved link preview persisted on the post row at publish time.
export interface LinkEmbed {
  description?: string | null;
  // RAW remote image URL. Never rendered directly - always proxied through
  // /api/link-preview/image so viewer IPs never reach the origin site.
  imageUrl?: string | null;
  siteName?: string | null;
  // Human title shown instead of the raw URL ("prettified").
  title: string;
  type: "link" | "youtube";
  // Sanitized display/href URL.
  url: string;
  // YouTube only: 11-char video id.
  videoAuthor?: string | null;
  videoId?: string | null;
}

// A YouTube video id is strictly 11 chars of the base64url alphabet;
// anything else must never reach an image/player URL.
const YOUTUBE_ID_SAFE = /^[A-Za-z0-9_-]{11}$/;

export function isSafeYoutubeId(
  videoId: string | null | undefined
): videoId is string {
  return typeof videoId === "string" && YOUTUBE_ID_SAFE.test(videoId);
}

// The deterministic poster frame for a YouTube embed, or null when the id
// is missing/malformed.
export function youtubeEmbedThumbnail(
  videoId: string | null | undefined
): string | null {
  if (!isSafeYoutubeId(videoId)) {
    return null;
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

// Every remote image goes through the SSRF-guarded proxy route, rooted at
// the API base (dev server or prod) since mobile has no same-origin /api.
export function embedImageUrl(apiBase: string, rawUrl: string): string {
  return `${apiBase.replace(/\/+$/, "")}/api/link-preview/image?url=${encodeURIComponent(rawUrl)}`;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Validates stored embed payloads (a JSON string on the post row, or an
// already-parsed array). Drops anything without a URL + title, and any
// YouTube entry without a valid id (it would render nothing).
export function parseStoredEmbeds(value: unknown): LinkEmbed[] {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  const embeds: LinkEmbed[] = [];
  for (const entry of raw) {
    if (embeds.length >= MAX_POST_EMBEDS) {
      break;
    }
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.url !== "string" || typeof record.title !== "string") {
      continue;
    }
    const type = record.type === "youtube" ? "youtube" : "link";
    const videoId =
      type === "youtube" && typeof record.videoId === "string"
        ? record.videoId
        : null;
    if (type === "youtube" && !isSafeYoutubeId(videoId)) {
      continue;
    }
    embeds.push({
      description: textOf(record.description),
      imageUrl: textOf(record.imageUrl),
      siteName: textOf(record.siteName),
      title: record.title,
      type,
      url: record.url,
      videoAuthor: textOf(record.videoAuthor),
      videoId,
    });
  }
  return embeds;
}
