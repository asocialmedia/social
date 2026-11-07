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

// One faceted or plain-text link inside a Bluesky post body, the input the
// missing-preview backfill scans. Mirrors the ExternalPost segment shape
// without importing the protocols package (this file stays dependency-free).
export interface PreviewSegment {
  href?: string | null;
  text?: string | null;
}

// Matches the bio renderer's URL pattern (and the preview resolver's): a link
// that renders as a link in the body is the same link that gets a preview.
const SEGMENT_URL_PATTERN = /https?:\/\/[^\s<>"'`{}|\\^]+/gu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/u;

// Facet text can be a human label or a truncated URL. Only the former is a
// useful title; otherwise keep the actual destination's path visible.
// Ported from web's lib/link-embeds/bluesky-links.ts.
export function linkFallbackLabel(url: string, text?: string | null): string {
  const label = text?.trim();
  if (
    label &&
    !label.includes("…") &&
    !label.endsWith("...") &&
    !/^(?:https?:\/\/|www\.|[^\s/]+\.[a-z]{2,}(?:[/…]|$))/iu.test(label)
  ) {
    return label;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return label || url;
  }
  return `${parsed.hostname.replace(/^www\./u, "")}${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
}

// Missing-preview backfill selection, ported from web's blueskyLinkPreviews
// (lib/link-embeds/bluesky-links.ts). A missing attached card gets one
// preview, matching Bluesky's single-card layout; existing upstream cards
// render immediately and require no scrape. Returns at most one fallback
// embed shape (no description/image yet - the resolver fills those in).
export function blueskyLinkFallbacks(
  segments: readonly PreviewSegment[],
  text: string | null | undefined,
  stored: readonly LinkEmbed[]
): LinkEmbed[] {
  if (stored.length >= 1) {
    return [];
  }
  const links = new Map<string, string>();
  for (const segment of segments) {
    if (!segment.href || segment.text?.startsWith("@")) {
      continue;
    }
    const { href } = segment;
    if (!links.has(href)) {
      links.set(href, segment.text ?? href);
    }
  }
  const plainText =
    segments.length > 0
      ? segments
          .filter((segment) => !segment.href)
          .map((segment) => segment.text ?? "")
          .join(" ")
      : (text ?? "");
  for (const match of plainText.matchAll(SEGMENT_URL_PATTERN)) {
    const raw = match[0].replace(TRAILING_PUNCTUATION, "");
    if (!links.has(raw)) {
      links.set(raw, raw);
    }
  }
  const [first] = [...links].slice(0, 1);
  if (!first) {
    return [];
  }
  const [url, label] = first;
  let siteName: string;
  try {
    siteName = new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return [];
  }
  return [
    {
      siteName,
      title: linkFallbackLabel(url, label),
      type: "link",
      url,
    },
  ];
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
