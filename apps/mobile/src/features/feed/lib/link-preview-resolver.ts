// Link preview resolution for short-form content (eddie and comment bodies).
//
// Posts resolve and store their embeds server-side at publish time, so the feed
// only renders trusted rows. Eddies and comments do not: web resolves them on
// read, asking /api/link-preview for each URL in the body. This is that path,
// plus the URL sanitization rules ported from web's lib/link-embeds/shared.ts
// so a previewed href is stripped of tracking params and credentials exactly
// like a stored one.
//
// The rules are duplicated from the web app rather than imported from it on
// purpose: sanitization is a security boundary, and drift between the two
// copies would mean a native client rendering a URL the server would refuse.
//
// No telemetry import here. The logger is injected so this module stays pure
// and unit-testable on Node, since importing the real logger pulls in
// react-native through the OTel exporter, which Bun cannot parse.

import {
  MAX_POST_EMBEDS,
  parseStoredEmbeds,
} from "@/features/feed/lib/link-embeds";
import type { LinkEmbed } from "@/features/feed/lib/link-embeds";
import { HttpError, withRetry } from "@/features/media-upload/lib/retry";

export const URL_MAX_LENGTH = 2048;

// Web reuses this staleness window for bio link badges; a preview is cheap to
// refetch and goes stale long before the content it describes does.
export const PREVIEW_STALE_TIME_MS = 1000 * 60 * 30;

const TRACKING_PARAM_RE =
  /^(?:utm_[a-z_]+|fbclid|gclid|dclid|msclkid|igsh|igshid|si|ref_src|ref_url|cmpid|spm|scid|twclid|yclid|_hsenc|_hsmi|mc_cid|mc_eid)$/i;

const KEPT_PARAMS = new Set(["v", "t", "start", "list", "index", "abtestid"]);

// Matches the pattern the bio renderer already uses, so a link that renders as
// a link in the body is the same link that gets previewed.
const URL_PATTERN = /https?:\/\/[^\s<>"'`{}|\\^]+/gu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/u;

/**
 * Normalizes a URL for display and href: strips tracking params, removes
 * embedded credentials, caps length, and upgrades the scheme to https. Returns
 * null when the URL is not http(s), over-length, or unparseable.
 */
export function sanitizeEmbedUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  // Credentials are never displayed and never sent to the resolver.
  parsed.username = "";
  parsed.password = "";
  if (parsed.href.length > URL_MAX_LENGTH) {
    return null;
  }
  const kept = new URLSearchParams();
  for (const [key, value] of parsed.searchParams) {
    if (KEPT_PARAMS.has(key.toLowerCase()) || !TRACKING_PARAM_RE.test(key)) {
      kept.append(key, value);
    }
  }
  const query = kept.toString();
  const base = `https://${parsed.host}${parsed.pathname}`;
  return query ? `${base}?${query}` : base;
}

/**
 * Up to MAX_POST_EMBEDS unique sanitized http(s) URLs from a body, in
 * first-appearance order. The dedupe key is the sanitized URL, so a tracked
 * and untracked spelling of the same link produce one preview.
 */
export function extractPostUrls(content: string | null | undefined): string[] {
  if (!content) {
    return [];
  }
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of content.matchAll(URL_PATTERN)) {
    if (urls.length >= MAX_POST_EMBEDS) {
      break;
    }
    const raw = match[0].replace(TRAILING_PUNCTUATION, "");
    if (raw.length > URL_MAX_LENGTH) {
      continue;
    }
    const sanitized = sanitizeEmbedUrl(raw);
    if (!sanitized || seen.has(sanitized)) {
      continue;
    }
    seen.add(sanitized);
    urls.push(sanitized);
  }
  return urls;
}

// Same shape as telemetry's LogAttributes: every value here is a primitive.
export type PreviewLogAttributes = Record<string, string | number | boolean>;

export interface PreviewLogger {
  info: (message: string, attributes?: PreviewLogAttributes) => void;
  warn: (message: string, attributes?: PreviewLogAttributes) => void;
}

export interface LinkPreviewResolver {
  /** Drops memoized previews, so a caller can force a refetch. */
  clear: () => void;
  /** Resolves one already-sanitized URL. */
  load: (url: string) => Promise<LinkEmbed | null>;
  /** Resolves every URL in a body, dropping the ones that yield nothing. */
  loadAll: (content: string | null | undefined) => Promise<LinkEmbed[]>;
}

interface CacheEntry {
  fetchedAt: number;
  promise: Promise<LinkEmbed | null>;
}

export function createLinkPreviewResolver({
  apiBase,
  baseFetch = fetch,
  log,
  now = Date.now,
}: {
  apiBase: string;
  baseFetch?: typeof fetch;
  log: PreviewLogger;
  now?: () => number;
}): LinkPreviewResolver {
  const cache = new Map<string, CacheEntry>();
  const root = apiBase.replace(/\/+$/, "");

  async function fetchPreview(url: string): Promise<LinkEmbed | null> {
    const payload = await withRetry(
      async () => {
        const response = await baseFetch(
          `${root}/api/link-preview?url=${encodeURIComponent(url)}`,
          { headers: { accept: "application/json" } }
        );
        if (!response.ok) {
          // Web retries this once. A 4xx will not become a 200 on a retry, so
          // HttpError keeps withRetry from spending one on it.
          throw new HttpError(
            `Link preview failed for ${url}`,
            response.status
          );
        }
        return await response.json();
      },
      {
        attempts: 2,
        baseMs: 400,
        onRetry: (error, attempt, delayMs) =>
          log.warn("link_preview.retry", {
            attempt,
            delayMs,
            status: error instanceof HttpError ? error.status : 0,
          }),
      }
    );
    // The route answers with an { embed } envelope; the embed itself is
    // untrusted input scraped from a third-party page, so it has to clear the
    // same validation bar as a persisted embed before it is rendered.
    const envelope =
      payload && typeof payload === "object" && "embed" in payload
        ? (payload as { embed: unknown }).embed
        : null;
    const [embed] = parseStoredEmbeds([envelope]);
    if (!embed) {
      log.warn("link_preview.rejected", { url });
      return null;
    }
    return embed;
  }

  function load(url: string): Promise<LinkEmbed | null> {
    const cached = cache.get(url);
    if (cached && now() - cached.fetchedAt < PREVIEW_STALE_TIME_MS) {
      return cached.promise;
    }
    // A dead preview endpoint must never reject into the caller: the body
    // still renders, it just has no card under it.
    const promise = (async () => {
      try {
        return await fetchPreview(url);
      } catch (error) {
        log.warn("link_preview.failed", {
          reason: error instanceof Error ? error.message : String(error),
          url,
        });
        return null;
      }
    })();
    // Memoized on the in-flight promise, so two bodies containing the same
    // link share one request instead of racing two.
    cache.set(url, { fetchedAt: now(), promise });
    return promise;
  }

  return {
    clear: () => cache.clear(),
    load,
    async loadAll(content) {
      const urls = extractPostUrls(content);
      if (urls.length === 0) {
        return [];
      }
      const resolved = await Promise.all(urls.map((url) => load(url)));
      const embeds = resolved.filter(
        (embed): embed is LinkEmbed => embed !== null
      );
      log.info("link_preview.resolved", {
        count: embeds.length,
        requested: urls.length,
      });
      return embeds;
    },
  };
}
