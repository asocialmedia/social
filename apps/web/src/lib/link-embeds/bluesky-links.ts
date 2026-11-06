import type { ExternalPost } from "@asm/protocols/contracts";

import { extractPostUrls, sanitizeEmbedUrl } from "./shared";
import type { LinkEmbed } from "./shared";

// Facet text can be a human label or a truncated URL. Only the former is a
// useful title; otherwise keep the actual destination's path visible.
export function linkFallbackLabel(url: string, text?: string) {
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

export function blueskyLinkPreviews(post: ExternalPost, stored: LinkEmbed[]) {
  // A missing attached card gets one preview, matching Bluesky's single-card
  // layout. Existing upstream cards render immediately and require no scrape.
  if (stored.length >= 1) {
    return [];
  }
  const links = new Map<string, string>();
  for (const segment of post.segments) {
    if (!segment.href || segment.text.startsWith("@")) {
      continue;
    }
    const url = sanitizeEmbedUrl(segment.href);
    if (url && !links.has(url)) {
      links.set(url, segment.text);
    }
  }
  // Detect unfaceted URLs in plain segments too, even beside a valid mention.
  const plainText = post.segments.length
    ? post.segments
        .filter((segment) => !segment.href)
        .map((segment) => segment.text)
        .join(" ")
    : post.text;
  for (const url of extractPostUrls(plainText)) {
    if (!links.has(url)) {
      links.set(url, url);
    }
  }
  return [...links].slice(0, 1).map(([url, text]) => ({
    siteName: new URL(url).hostname.replace(/^www\./u, ""),
    title: linkFallbackLabel(url, text),
    type: "link" as const,
    url,
  }));
}
