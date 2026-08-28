// Server-side link-embed resolution: SSRF-guarded fetching, per-platform
// resolvers (YouTube oEmbed, X syndication, generic OpenGraph), and Redis
// response caching. Server-only: imports node dns + the shared redis proxy.

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";

import { redis } from "@asm/db";

import { parseOgMeta } from "./og-parse";
import {
  extractPostUrls,
  isPrivateOrReservedHost,
  MAX_POST_EMBEDS,
  sanitizeEmbedUrl,
  youtubeVideoIdFromUrl,
} from "./shared";
import type { LinkEmbed } from "./shared";

export { type LinkEmbed } from "./shared";

const FETCH_TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 3;
// Meta tags live in <head>; anything past a few hundred KB cannot help us.
const MAX_HTML_BYTES = 512 * 1024;
const MAX_OEMBED_BYTES = 64 * 1024;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const FETCH_UA =
  "Mozilla/5.0 (compatible; asocialmedia-link-bot/1.0; +https://asocialmedia.cc/bot)";

const EMBED_CACHE_TTL_SECONDS = 6 * 60 * 60;
const EMBED_FAILURE_TTL_SECONDS = 10 * 60;

const embedCacheKey = (url: string): string =>
  `linkembed:v1:${createHash("sha256").update(url).digest("hex")}`;

interface CacheEntry {
  embed: LinkEmbed | null;
}

// ── SSRF guard ──────────────────────────────────────────────────────────────
// Defense in depth against server-side request forgery: every hop of every
// fetch must pass (1) scheme + hostname checks, (2) DNS resolution where ALL
// resolved addresses fall in public ranges, (3) response content-type checks
// at the call sites. The DNS check has the classic rebinding TOCTOU window;
// mitigated by re-validating the final response URL and by the size/type
// caps - the guard exists to make internal probing impractical, not to build
// a perfect firewall.

interface GuardedUrl {
  fetchUrl: URL;
  host: string;
}

async function validatePublicHttpUrl(
  rawUrl: string
): Promise<GuardedUrl | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  if (parsed.hostname.length > 253) {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (isPrivateOrReservedHost(host)) {
    return null;
  }
  // Non-special-scheme-style hostnames that browsers would still resolve
  // (single-label hosts like "router") fail the dot check unless they are
  // IP literals - single labels inside a resolver can hit search domains.
  const isIpLiteral =
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
  if (!isIpLiteral && !host.includes(".")) {
    return null;
  }
  try {
    const records = await lookup(host, { all: true, verbatim: true });
    if (records.length === 0) {
      return null;
    }
    for (const record of records) {
      if (isPrivateOrReservedHost(record.address)) {
        return null;
      }
    }
  } catch {
    // DNS failure: cannot verify the target is public - fail closed.
    return null;
  }
  return { fetchUrl: parsed, host };
}

interface GuardedResponse {
  body: ReadableStream<Uint8Array>;
  contentType: string | null;
  finalUrl: string;
  status: number;
}

// Follows up to MAX_REDIRECTS, re-validating every hop's URL against the
// SSRF guard so a public URL cannot 302 into internal space.
// oxlint-disable no-await-in-loop -- redirect hops are inherently sequential: each hop's Location decides the next request
async function guardedFetch(
  rawUrl: string,
  maxBytes: number
): Promise<GuardedResponse | null> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const guarded = await validatePublicHttpUrl(current);
    if (!guarded) {
      return null;
    }
    let response: Response;
    try {
      response = await fetch(guarded.fetchUrl.href, {
        headers: {
          accept: "text/html,application/json;q=0.9,*/*;q=0.5",
          // Spoofed only as far as required to receive og metadata that
          // sites gate on the user agent string.
          "accept-language": "en-US,en;q=0.9",
          "user-agent": FETCH_UA,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        return null;
      }
      try {
        current = new URL(location, guarded.fetchUrl.href).href;
      } catch {
        return null;
      }
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return null;
    }
    const contentType = response.headers.get("content-type");
    const finalUrl = response.url || guarded.fetchUrl.href;
    // Post-follow re-validation: the URL the bytes actually came from.
    const finalGuard = await validatePublicHttpUrl(finalUrl);
    if (!finalGuard) {
      await response.body.cancel();
      return null;
    }
    return {
      body: capStream(response.body, maxBytes),
      contentType,
      finalUrl,
      status: response.status,
    };
  }
  return null;
}
// oxlint-enable no-await-in-loop

// Reads at most maxBytes from a response body before truncating, so a huge
// or endless body cannot pin worker memory.
function capStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): ReadableStream<Uint8Array> {
  let total = 0;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async cancel() {
      await reader.cancel().catch(() => null);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        const remaining = maxBytes - (total - value.byteLength);
        if (remaining > 0) {
          controller.enqueue(value.slice(0, remaining));
        }
        controller.close();
        await reader.cancel().catch(() => null);
        return;
      }
      controller.enqueue(value);
    },
  });
}

async function readCapped(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<string> {
  const decoder = new TextDecoder();
  let html = "";
  for await (const chunk of stream) {
    html += decoder.decode(chunk, { stream: true });
    if (html.length > maxBytes) {
      break;
    }
  }
  return html.slice(0, maxBytes);
}

// ── Platform resolvers ──────────────────────────────────────────────────────

async function fetchJson(
  url: string,
  maxBytes: number
): Promise<Record<string, unknown> | null> {
  const response = await guardedFetch(url, maxBytes);
  if (!response || response.status !== 200) {
    return null;
  }
  const contentType = (response.contentType ?? "").toLowerCase();
  if (!contentType.includes("json") && !contentType.includes("text")) {
    await response.body.cancel().catch(() => null);
    return null;
  }
  try {
    const text = await readCapped(response.body, maxBytes);
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function resolveYouTube(
  url: string,
  videoId: string
): Promise<LinkEmbed | null> {
  // The oEmbed endpoint wants the canonical watch URL.
  const oembedTarget = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
  const data = await fetchJson(oembedTarget, MAX_OEMBED_BYTES);
  const author = asString(data?.author_name);
  return {
    description: author ? `By ${author}` : null,
    // No stored thumbnail: the renderer derives the deterministic
    // i.ytimg.com/vi/<id> URL, so nothing extra is fetched or trusted.
    imageUrl: null,
    siteName: "YouTube",
    title: asString(data?.title) ?? `YouTube video · ${videoId}`,
    type: "youtube",
    url,
    videoAuthor: author,
    videoId,
  };
}

const X_STATUS_ID_RE = /\/status(?:es)?\/(?<id>\d{5,25})/u;

function xStatusId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (host !== "x.com" && host !== "twitter.com") {
    return null;
  }
  const match = parsed.pathname.match(X_STATUS_ID_RE);
  return match?.groups?.id ?? null;
}

async function resolveXPost(url: string): Promise<LinkEmbed | null> {
  const statusId = xStatusId(url);
  if (!statusId) {
    return null;
  }
  // Public syndication endpoint (no auth); the token value is fixed by the
  // API and only gates anonymous browser clients.
  const data = await fetchJson(
    `https://cdn.syndication.twimg.com/tweet-result?id=${statusId}&token=x&lang=en`,
    256 * 1024
  );
  const xUser =
    typeof data?.user === "object" && data.user !== null
      ? (data.user as Record<string, unknown>)
      : undefined;
  const author = asString(xUser?.name);
  const handle = asString(xUser?.screen_name);
  const text = asString(data?.text);
  if (!text && !author) {
    // Syndication failed or returned an empty shell - fall through to OG.
    return null;
  }
  const mediaList = Array.isArray(data?.mediaDetails)
    ? (data?.mediaDetails as { media_url_https?: unknown }[])
    : [];
  const photo = mediaList.find(
    (item) => typeof item?.media_url_https === "string"
  )?.media_url_https;
  return {
    description: text,
    imageUrl: typeof photo === "string" ? photo : null,
    siteName: "X",
    title: author ? `${author} on X` : "Post on X",
    type: "link",
    url,
    videoAuthor: handle ? `@${handle}` : (author ?? "X"),
    videoId: null,
  };
}

async function resolveOpenGraph(url: string): Promise<LinkEmbed | null> {
  const response = await guardedFetch(url, MAX_HTML_BYTES);
  if (!response) {
    return null;
  }
  const contentType = (response.contentType ?? "").toLowerCase();
  if (
    contentType &&
    !contentType.includes("html") &&
    !contentType.includes("xml") &&
    !contentType.includes("text/plain")
  ) {
    await response.body.cancel().catch(() => null);
    return null;
  }
  const html = await readCapped(response.body, MAX_HTML_BYTES);
  const meta = parseOgMeta(html, response.finalUrl);
  if (!meta.title) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(response.finalUrl);
  } catch {
    return null;
  }
  return {
    description: meta.description,
    imageUrl: meta.imageUrl,
    siteName: meta.siteName ?? parsed.hostname.replace(/^www\./u, ""),
    title: meta.title,
    type: "link",
    url: sanitizeEmbedUrl(response.finalUrl) ?? url,
    videoAuthor: null,
    videoId: null,
  };
}

// ── Public entry points ─────────────────────────────────────────────────────

/**
 * Resolves one URL to an embed payload. Cache-first (6h successes, 10min
 * failures); rejects anything the SSRF guard does not like; returns null
 * when nothing renderable could be extracted.
 */
export async function resolveLinkEmbed(
  rawUrl: string
): Promise<LinkEmbed | null> {
  const url = sanitizeEmbedUrl(rawUrl);
  if (!url) {
    return null;
  }

  try {
    const cached = await redis.get(embedCacheKey(url));
    if (cached) {
      const entry = JSON.parse(cached) as CacheEntry;
      return entry.embed;
    }
  } catch {
    // Cache unavailable: fall through to a live fetch.
  }

  let embed: LinkEmbed | null = null;
  try {
    embed = await resolveUncached(url);
  } catch {
    embed = null;
  }

  try {
    await redis.set(
      embedCacheKey(url),
      JSON.stringify({ embed } satisfies CacheEntry),
      "EX",
      embed ? EMBED_CACHE_TTL_SECONDS : EMBED_FAILURE_TTL_SECONDS
    );
  } catch {
    // Cache write failure is non-fatal.
  }
  return embed;
}

async function resolveUncached(url: string): Promise<LinkEmbed | null> {
  const videoId = youtubeVideoIdFromUrl(url);
  if (videoId) {
    return await resolveYouTube(url, videoId);
  }

  const xEmbed = await resolveXPost(url);
  if (xEmbed) {
    return xEmbed;
  }

  return await resolveOpenGraph(url);
}

/**
 * Resolves embeds for every link in post content (first MAX_POST_EMBEDS,
 * author-dismissed links skipped). Total wall-clock is bounded by
 * EMBED_RESOLUTION_BUDGET_MS so post publishing can never hang on a slow
 * origin - unresolved links are simply omitted.
 */
export const EMBED_RESOLUTION_BUDGET_MS = 5000;

export async function resolvePostEmbeds(
  content: string,
  dismissedUrls: ReadonlySet<string>
): Promise<LinkEmbed[]> {
  const urls = extractPostUrls(content)
    .filter((url) => !dismissedUrls.has(url))
    .slice(0, MAX_POST_EMBEDS);
  if (urls.length === 0) {
    return [];
  }

  const budget = AbortSignal.timeout(EMBED_RESOLUTION_BUDGET_MS);
  const settled = await Promise.allSettled(
    urls.map(async (url) => {
      if (budget.aborted) {
        return null;
      }
      return await resolveLinkEmbed(url);
    })
  );
  const embeds: LinkEmbed[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled" && outcome.value) {
      embeds.push(outcome.value);
    }
  }
  return embeds.slice(0, MAX_POST_EMBEDS);
}

// ── Image proxy guard (used by /api/link-preview/image) ────────────────────

/**
 * Streams a remote embed image through the SSRF guard with hard type and
 * size caps. Returns null when the URL or payload is not a safe public
 * image; the route turns that into a 404.
 */
export async function fetchEmbedImage(
  rawUrl: string
): Promise<GuardedResponse | null> {
  const response = await guardedFetch(rawUrl, IMAGE_MAX_BYTES);
  if (!response) {
    return null;
  }
  const contentType = (response.contentType ?? "").toLowerCase();
  if (!contentType.startsWith("image/")) {
    await response.body.cancel().catch(() => null);
    return null;
  }
  return response;
}
