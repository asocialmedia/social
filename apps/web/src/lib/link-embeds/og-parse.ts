// OpenGraph/Twitter-card meta extraction from a bounded HTML string. Pure:
// takes the document text and the final URL, returns candidate embed fields.
// We never render the HTML itself - only the extracted strings survive, so
// there is no HTML/script injection surface by construction.

import {
  decodeHtmlEntities,
  EMBED_DESCRIPTION_MAX_LENGTH,
  EMBED_TITLE_MAX_LENGTH,
} from "./shared";

export interface OgMeta {
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  title: string | null;
}

// Meta candidates in priority order. og:* wins over twitter:*; <title> is
// the last resort.
const TITLE_KEYS = ["og:title", "twitter:title"];
const DESCRIPTION_KEYS = [
  "og:description",
  "twitter:description",
  "description",
];
const IMAGE_KEYS = [
  "og:image",
  "og:image:secure_url",
  "twitter:image",
  "twitter:image:src",
];

function truncate(value: string, maxLength: number): string {
  const normalized = value.replaceAll(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

interface MetaTag {
  content: string;
  key: string;
}

/**
 * Pulls <meta property="..."/name="..."> pairs out of an HTML string. The
 * regex only matches well-formed meta tags within the head-sized prefix we
 * hand it (the caller caps the download), and attribute order/content
 * quoting variations are tolerated. Script bodies are never parsed.
 */
export function extractMetaTags(html: string): MetaTag[] {
  const tags: MetaTag[] = [];
  const metaRe = /<meta\b[^>]*>/giu;
  for (const tag of html.match(metaRe) ?? []) {
    const key = readAttribute(tag, ["property", "name"]);
    const content = readAttribute(tag, ["content"]);
    if (key && content !== null) {
      tags.push({ content, key: key.toLowerCase() });
    }
  }
  return tags;
}

function readAttribute(tag: string, names: string[]): string | null {
  for (const name of names) {
    const re = new RegExp(
      `\\b${name}\\s*=\\s*("(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\\s"'>]+))`,
      "iu"
    );
    const match = tag.match(re);
    if (match?.groups) {
      const value =
        match.groups.double ?? match.groups.single ?? match.groups.bare ?? "";
      if (value) {
        return value;
      }
    }
  }
  return null;
}

function firstValue(tags: MetaTag[], keys: string[]): string | null {
  for (const key of keys) {
    const hit = tags.find((tag) => tag.key === key);
    if (hit?.content) {
      return decodeHtmlEntities(hit.content);
    }
  }
  return null;
}

/**
 * Parses the embed-relevant meta from an HTML document. Relative image URLs
 * are resolved against the FINAL response URL (post-redirect). The document
 * <title> only fills in when no og/twitter title exists.
 */
export function parseOgMeta(html: string, finalUrl: string): OgMeta {
  // Meta tags live in <head>; scanning past the first ~64KB is waste. The
  // slice also bounds the regex work on adversarial input.
  const head = html.slice(0, 65_536);
  const tags = extractMetaTags(head);

  let title = firstValue(tags, TITLE_KEYS);
  if (!title) {
    const titleMatch = head.match(
      /<title[^>]*>(?<text>[^<]{0,500})<\/title>/iu
    );
    if (titleMatch?.groups?.text) {
      title = decodeHtmlEntities(titleMatch.groups.text);
    }
  }

  const description = firstValue(tags, DESCRIPTION_KEYS);
  let imageUrl = firstValue(tags, IMAGE_KEYS);
  if (imageUrl) {
    imageUrl = resolveAgainst(imageUrl, finalUrl);
  }

  return {
    description: description
      ? truncate(description, EMBED_DESCRIPTION_MAX_LENGTH)
      : null,
    imageUrl,
    siteName: firstValue(tags, ["og:site_name", "application-name"]),
    title: title ? truncate(title, EMBED_TITLE_MAX_LENGTH) : null,
  };
}

function resolveAgainst(value: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(value, baseUrl);
    // Only http(s) images are proxied later; data:/javascript: URLs are
    // dropped here so they can never reach the image route.
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    return resolved.href;
  } catch {
    return null;
  }
}
