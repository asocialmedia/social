// Link-embed contracts and pure URL logic. Client-safe: no server imports.
// The server resolver (./server) and the React renderers both build on this,
// so the URL sanitization rules cannot drift between editor preview and the
// published post card.

// oxlint-disable no-bitwise -- IP-range classification is bitwise math by nature.

import LinkifyIt from "linkify-it";

// Hard cap on embed cards rendered below a post (mirrors Discord's behavior
// of collapsing link previews past the first few).
export const MAX_POST_EMBEDS = 5;

// A resolved link preview persisted on the post row at publish time.
export interface LinkEmbed {
  // og:description / tweet text, entity-decoded and length-capped.
  description?: string | null;
  // RAW remote image URL. Never rendered directly - always proxied through
  // /api/link-preview/image so viewer IPs never reach the origin site and
  // non-image payloads can never reach the browser.
  imageUrl?: string | null;
  siteName?: string | null;
  // Human title shown instead of the raw URL ("prettified").
  title: string;
  type: "link" | "youtube";
  // Sanitized display/href URL: tracking params stripped, credentials
  // removed, length-capped.
  url: string;
  // YouTube only: 11-char video id, rendered as a youtube-nocookie player.
  videoAuthor?: string | null;
  videoId?: string | null;
}

const linkify = new LinkifyIt();

// Display-side caps shared with the OG parser (kept here so client-side
// stored-embed validation and server-side scraping cannot drift).
export const EMBED_TITLE_MAX_LENGTH = 200;
export const EMBED_DESCRIPTION_MAX_LENGTH = 300;

// Tracking params stripped from every embedded link's display URL. Matching
// is case-insensitive and prefix-based for the utm family.
const TRACKING_PARAM_RE =
  /^(?:utm_[a-z_]+|fbclid|gclid|dclid|msclkid|igsh|igshid|si|ref_src|ref_url|cmpid|spm|scid|twclid|yclid|_hsenc|_hsmi|mc_cid|mc_eid)$/i;

// Query params that carry meaning and must survive sanitization even when a
// platform would call them "tracking" (YouTube's sharing param set).
const KEPT_PARAMS = new Set(["v", "t", "start", "list", "index", "abtestid"]);

export const URL_MAX_LENGTH = 2048;

/**
 * Normalizes a URL for storage/display: strips tracking query params,
 * removes embedded credentials, caps length, and collapses the protocol to
 * https for the href when the scheme was http (display-only upgrade; the
 * server resolver still validates whatever the author wrote). Returns null
 * when the URL is not http(s), over-length, or unparseable.
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
  // Credentials in the URL (https://user:pass@host) are never displayed.
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
  // Display href upgrades http to https: every mainstream link target
  // serves TLS, and mixed-origin http iframes/images would be blocked by
  // the browser anyway.
  const base = `https://${parsed.host}${parsed.pathname}`;
  return query ? `${base}?${query}` : base;
}
/**
 * Extracts up to MAX_POST_EMBEDS unique, sanitized http(s) URLs from post
 * content in first-appearance order. Dedupe key is the sanitized URL, so a
 * tracked and untracked form of the same link produce one embed.
 */
export function extractPostUrls(content: string): string[] {
  if (!content) {
    return [];
  }
  const matches = linkify.match(content) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of matches) {
    if (urls.length >= MAX_POST_EMBEDS) {
      break;
    }
    if (match.url.length > URL_MAX_LENGTH) {
      continue;
    }
    const sanitized = sanitizeEmbedUrl(match.url);
    if (!sanitized || seen.has(sanitized)) {
      continue;
    }
    seen.add(sanitized);
    urls.push(sanitized);
  }
  return urls;
}

// YouTube ids are exactly 11 chars of the base64url alphabet.
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extracts the video id from every YouTube URL shape: watch?v=, youtu.be/,
 /shorts/, /embed/, /live/. Returns null for non-videos.
 */
export function youtubeVideoIdFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  const isYouTube =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be";
  if (!isYouTube) {
    return null;
  }

  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0] ?? "";
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }

  const vParam = parsed.searchParams.get("v");
  if (vParam && YOUTUBE_ID_RE.test(vParam)) {
    return vParam;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const kinds = new Set(["shorts", "embed", "live", "v"]);
  if (segments.length >= 2 && kinds.has(segments[0]?.toLowerCase() ?? "")) {
    const id = segments[1] ?? "";
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }
  return null;
}

/**
 * True when the host is a loopback/reserved name or an IP literal inside a
 * private, link-local, or otherwise non-routable range. The server resolver
 * combines this with real DNS resolution (resolved A/AAAA records are checked
 * against the same ranges) so an attacker cannot bounce a fetch at internal
 * services via either hostname trickery or literal addresses.
 */
export function isPrivateOrReservedHost(rawHost: string): boolean {
  const host = rawHost.replace(/^\[/u, "").replace(/\]$/u, "").toLowerCase();
  if (!host) {
    return true;
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    host === "metadata.google.internal" ||
    host.endsWith(".svc") ||
    host.endsWith(".cluster.local")
  ) {
    return true;
  }
  // Strip IPv4-mapped IPv6 prefix (::ffff:127.0.0.1) before classification.
  const v4InV6 = host.match(/^::ffff:(?<ipv4>\d+\.\d+\.\d+\.\d+)$/u);
  if (v4InV6?.groups?.ipv4) {
    return isPrivateIpv4(v4InV6.groups.ipv4);
  }
  if (host.includes(":")) {
    return isPrivateIpv6(host);
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) {
    return isPrivateIpv4(host);
  }
  return false;
}

function ipv4ToLong(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null;
    }
    value = value * 256 + octet;
  }
  return value;
}

function isPrivateIpv4(address: string): boolean {
  const value = ipv4ToLong(address);
  if (value === null) {
    return true; // Unparseable addresses fail closed.
  }
  const ranges: [number, number][] = [
    [0x00_00_00_00, 0xff_00_00_00], // 0.0.0.0/8 "this network"
    [0x0a_00_00_00, 0xff_00_00_00], // 10/8 private
    [0x64_40_00_00, 0xff_c0_00_00], // 100.64/10 CGNAT
    [0x7f_00_00_00, 0xff_00_00_00], // 127/8 loopback
    [0xa9_fe_00_00, 0xff_ff_00_00], // 169.254/16 link-local
    [0xac_10_00_00, 0xff_f0_00_00], // 172.16/12 private
    [0xc0_00_00_00, 0xff_ff_ff_00], // 192.0.0/24 IETF protocol assignments
    [0xc0_00_02_00, 0xff_ff_ff_00], // 192.0.2/24 TEST-NET-1
    [0xc0_58_63_00, 0xff_c0_00_00], // 192.88.99/24 6to4 relay
    [0xc0_a8_00_00, 0xff_ff_00_00], // 192.168/16 private
    [0xc6_12_00_00, 0xff_fe_00_00], // 198.18/15 benchmarking
    [0xc6_33_64_00, 0xff_ff_ff_00], // 198.51.100/24 TEST-NET-2
    [0xcb_00_71_00, 0xff_ff_ff_00], // 203.0.113/24 TEST-NET-3
    [0xe0_00_00_00, 0xf0_00_00_00], // 224/4 multicast
    [0xf0_00_00_00, 0xf0_00_00_00], // 240/4 reserved + 255.255.255.255 broadcast
  ];
  return ranges.some(
    // Bitwise ops are 32-bit signed in JS; masks above 2^31 come out
    // negative, so both sides are normalized back to unsigned.
    ([base, mask]) => (value & mask) >>> 0 === base
  );
}

// Expands an IPv6 address to eight 16-bit groups. Handles ::, embedded IPv4
// tails, and zone ids. Returns null on malformed input.
function parseIpv6Groups(side: string): number[] | null {
  if (side === "") {
    return [];
  }
  const groups: number[] = [];
  for (const group of side.split(":")) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) {
      return null;
    }
    groups.push(Number.parseInt(group, 16));
  }
  return groups;
}

function expandIpv6(address: string): number[] | null {
  const withoutZone = address.split("%")[0] ?? "";
  let value = withoutZone;
  let v4Tail: number[] | null = null;
  const v4Match = withoutZone.match(
    /^(?<head>.*:)(?<ipv4>\d+\.\d+\.\d+\.\d+)$/u
  );
  if (
    v4Match?.groups?.head !== undefined &&
    v4Match.groups.ipv4 !== undefined
  ) {
    const long = ipv4ToLong(v4Match.groups.ipv4);
    if (long === null) {
      return null;
    }
    const low16 = long % 65_536;
    const high16 = Math.floor(long / 65_536);
    v4Tail = [high16, low16];
    value = v4Match.groups.head.endsWith(":")
      ? v4Match.groups.head
      : `${v4Match.groups.head}:`;
  }
  const halves = value.split("::");
  if (halves.length > 2) {
    return null;
  }
  const head = parseIpv6Groups(halves[0] ?? "");
  const tail = parseIpv6Groups(halves[1] ?? "");
  if (head === null || tail === null) {
    return null;
  }
  const middle = v4Tail ?? [];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length - middle.length;
    if (missing < 0) {
      return null;
    }
    const zeros = Array.from<number>({ length: missing }).fill(0);
    return [...head, ...zeros, ...middle, ...tail];
  }
  if (head.length + tail.length + middle.length !== 8) {
    return null;
  }
  return [...head, ...middle, ...tail];
}

function isPrivateIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups || groups.length !== 8) {
    return true; // Malformed addresses fail closed.
  }
  const allZeroExcept = (index: number): boolean =>
    groups.every((group, position) => position === index || group === 0);
  // ::1 loopback (any position is nonstandard; both forms covered)
  if (groups[7] === 1 && allZeroExcept(7)) {
    return true;
  }
  // Unspecified ::
  if (groups.every((group) => group === 0)) {
    return true;
  }
  const top = groups[0] ?? 0;
  // fe80::/10: top 10 bits 1111111010
  if ((top & 0xff_c0) === 0xfe_80) {
    return true;
  }
  // fc00::/7: top 7 bits 1111110
  if ((top & 0xfe_00) === 0xfc_00) {
    return true;
  }
  // ::ffff:0:0/96 handled earlier by the v4-mapped branch, but catch raw form
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    (groups[5] ?? 0) === 0xff_ff
  ) {
    return true;
  }
  // 64:ff9b::/96 well-known NAT64 - translates to IPv4 space we must treat
  // like the mapped range (the embedded v4 is checked by the caller's DNS
  // path; the literal form fails closed here).
  if (top === 0x00_64 && (groups[1] ?? 0) === 0xff_9b) {
    return true;
  }
  // 2002::/16 6to4 - embeds an IPv4 in groups 1-2; conservative reject.
  if (top === 0x20_02) {
    return true;
  }
  // Teredo 2001::/32 - conservative reject.
  if (top === 0x20_01 && (groups[1] ?? 0) === 0) {
    return true;
  }
  // documentation ranges 2001:db8::/32
  if (top === 0x20_01 && (groups[1] ?? 0) === 0x0d_b8) {
    return true;
  }
  return false;
}

/**
 * Validates a stored Post.embeds JSON value into LinkEmbed[] (defense
 * against garbage/stale rows): only well-shaped entries survive, capped at
 * MAX_POST_EMBEDS. The YouTube video id is re-checked against the strict
 * alphabet so the client renderer's iframe src can trust it.
 */
export function parseStoredEmbeds(value: unknown): LinkEmbed[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const embeds: LinkEmbed[] = [];
  for (const raw of value) {
    if (embeds.length >= MAX_POST_EMBEDS) {
      break;
    }
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const record = raw as Record<string, unknown>;
    const { url } = record;
    const { title } = record;
    if (typeof url !== "string" || typeof title !== "string") {
      continue;
    }
    const type = record.type === "youtube" ? "youtube" : "link";
    const videoId =
      type === "youtube" && typeof record.videoId === "string"
        ? (youtubeVideoIdFromUrl(`https://youtu.be/${record.videoId}`) ??
          youtubeVideoIdFromUrl(
            `https://www.youtube.com/watch?v=${record.videoId}`
          ))
        : null;
    if (type === "youtube" && !videoId) {
      // A youtube embed without a valid id renders nothing - drop it.
      continue;
    }
    const description =
      typeof record.description === "string" && record.description.length <= 600
        ? record.description
        : null;
    const imageUrl =
      typeof record.imageUrl === "string" &&
      record.imageUrl.length <= 2048 &&
      /^https?:\/\//iu.test(record.imageUrl)
        ? record.imageUrl
        : null;
    const siteName =
      typeof record.siteName === "string" && record.siteName.length <= 100
        ? record.siteName
        : null;
    embeds.push({
      description,
      imageUrl,
      siteName,
      title: title.slice(0, EMBED_TITLE_MAX_LENGTH),
      type,
      // Re-sanitize: the href must always be a clean http(s) URL no matter
      // what ended up in the column.
      url: sanitizeEmbedUrl(url) ?? url,
      videoAuthor:
        typeof record.videoAuthor === "string" &&
        record.videoAuthor.length <= 100
          ? record.videoAuthor
          : null,
      videoId,
    });
  }
  return embeds;
}

/**
 * Decodes the handful of HTML entities browsers normalize inside attribute
 * values. Only used on meta-tag content we extract - never on raw HTML we
 * would render.
 */
export function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll(/&#0?39;/gu, "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .replaceAll(/&#(?<code>\d+);/gu, (match, code: string) => {
      const point = Number(code);
      return Number.isInteger(point) && point > 0 && point <= 0x10_ff_ff
        ? String.fromCodePoint(point)
        : match;
    })
    .replaceAll("&amp;", "&");
}
