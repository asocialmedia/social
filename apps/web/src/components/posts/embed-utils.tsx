"use client";

import { useState } from "react";

// Shared render helpers for link embeds. Kept separate from the PostLinkEmbeds
// renderer (and its editor counterpart) so the components can import these
// without forming a dependency cycle.

// Deterministic, CSP-safe thumbnail for any embed. Every remote image goes
// through the SSRF-guarded proxy route - raw third-party URLs are never
// handed to the browser.
export function embedImageProxyUrl(rawUrl: string): string {
  return `/api/link-preview/image?url=${encodeURIComponent(rawUrl)}`;
}

// Letter tile standing in for favicons: zero external requests (a favicon
// service would leak every viewer's IP to a third party), still gives the
// card a recognizable origin mark.
export function EmbedSiteBadge({
  siteName,
}: {
  siteName: string | null | undefined;
}) {
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
