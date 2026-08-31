"use client";

import { useState } from "react";

import { platformFromUrl } from "./link-badge";

// Shared render helpers for link embeds. Kept separate from the PostLinkEmbeds
// renderer (and its editor counterpart) so the components can import these
// without forming a dependency cycle.

// Deterministic, CSP-safe thumbnail for any embed. Every remote image goes
// through the SSRF-guarded proxy route - raw third-party URLs are never
// handed to the browser.
export function embedImageProxyUrl(rawUrl: string): string {
  return `/api/link-preview/image?url=${encodeURIComponent(rawUrl)}`;
}

// Platform-aware origin badge: renders the brand mark (YouTube/Spotify/GitHub
// /X/Reddit) when the URL or siteName resolves to a known platform, otherwise
// falls back to a single-letter tile. No favicon fetch (privacy), just the
// bundled react-icons set.
export function EmbedSiteBadge({
  siteName,
  url,
}: {
  siteName: string | null | undefined;
  url?: string | null;
}) {
  // Prefer the canonical embed URL for exact host matching (covers
  // open.spotify.com, gist.github.com, m.youtube.com, etc.).
  if (url) {
    const platform = platformFromUrl(url);
    if (platform) {
      const { Icon, className } = platform;
      return (
        <span className="bg-muted flex h-4 w-4 shrink-0 items-center justify-center rounded-sm">
          <Icon className={`size-3 ${className}`} />
        </span>
      );
    }
  }
  // Fallback: siteName is the OG site_name ("Spotify", "GitHub", "YouTube").
  // Match case-insensitively when URL is absent (editor preview) or didn't
  // resolve above.
  const normalizedSite = (siteName ?? "").toLowerCase();
  if (normalizedSite.includes("spotify")) {
    const platform = platformFromUrl("https://open.spotify.com");
    if (platform) {
      const { Icon, className } = platform;
      return (
        <span className="bg-muted flex h-4 w-4 shrink-0 items-center justify-center rounded-sm">
          <Icon className={`size-3 ${className}`} />
        </span>
      );
    }
  }
  if (normalizedSite.includes("github")) {
    const platform = platformFromUrl("https://github.com");
    if (platform) {
      const { Icon, className } = platform;
      return (
        <span className="bg-muted flex h-4 w-4 shrink-0 items-center justify-center rounded-sm">
          <Icon className={`size-3 ${className}`} />
        </span>
      );
    }
  }
  const host = (siteName ?? "link").replace(/^www\./u, "");
  const letter = (host[0] ?? "L").toUpperCase();
  return (
    <span className="bg-muted text-muted-foreground flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold">
      {letter}
    </span>
  );
}

export function useEmbedImageError(imageUrl: string | null | undefined) {
  const [failed, setFailed] = useState(false);
  return {
    failed: failed || !imageUrl,
    handleError: () => setFailed(true),
  };
}
