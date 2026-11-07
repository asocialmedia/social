// Links inside a decrypted message body.
//
// Ported from web's message-link-embed.tsx, lib/posts/post-url.ts
// (postIdFromUrl) and lib/link-embeds/shared.ts (youtubeVideoIdFromUrl). DMs
// unfurl only the first URL, like web: one preview request per bubble and a
// predictable row height. Pure, so it runs under bun test.

// The same body pattern the feed's preview resolver uses, so the URL that is
// tappable in the text is the URL that gets previewed.
const URL_PATTERN = /https?:\/\/[^\s<>"'`{}|\\^]+/gu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/u;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const PLACEHOLDER_ORIGIN = "https://internal.invalid";

export type MessageTextSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; url: string };

// Splits a body into plain runs and link runs, keeping every character so the
// rendered text is identical to what was sent.
export function splitMessageText(content: string): MessageTextSegment[] {
  const segments: MessageTextSegment[] = [];
  let cursor = 0;
  for (const match of content.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    if (url.length === 0) {
      continue;
    }
    if (start > cursor) {
      segments.push({ kind: "text", text: content.slice(cursor, start) });
    }
    segments.push({ kind: "link", text: url, url });
    cursor = start + url.length;
  }
  if (cursor < content.length) {
    segments.push({ kind: "text", text: content.slice(cursor) });
  }
  return segments;
}

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
    return YOUTUBE_ID.test(id) ? id : null;
  }
  const vParam = parsed.searchParams.get("v");
  if (vParam && YOUTUBE_ID.test(vParam)) {
    return vParam;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const kinds = new Set(["shorts", "embed", "live", "v"]);
  if (segments.length >= 2 && kinds.has(segments[0]?.toLowerCase() ?? "")) {
    const id = segments[1] ?? "";
    return YOUTUBE_ID.test(id) ? id : null;
  }
  return null;
}

// An asocialmedia post URL's (possibly short) id, or null. Host-gated to the
// app's own origins: a foreign site's /posts/123 is not an internal post. The
// device has no window origin, so the caller passes the API base and the
// production origin.
export function postIdFromUrl(
  rawUrl: string,
  origins: readonly string[]
): string | null {
  const isRelative = rawUrl.startsWith("/");
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, isRelative ? PLACEHOLDER_ORIGIN : undefined);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (!isRelative) {
    const hosts = origins.flatMap((origin) => {
      try {
        return [new URL(origin).host];
      } catch {
        return [];
      }
    });
    if (!hosts.includes(parsed.host)) {
      return null;
    }
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0] === "gusts") {
    const id = parsed.searchParams.get("id");
    return id && id.length >= 8 ? id : null;
  }
  if (segments[0] === "posts" && segments[1]) {
    return segments[1];
  }
  if (
    segments[0] === "a" &&
    segments[1] &&
    segments[2] === "posts" &&
    segments[3]
  ) {
    return segments[3];
  }
  return null;
}

export function firstMessageUrl(content: string): string | null {
  return (
    splitMessageText(content).find((segment) => segment.kind === "link")
      ?.text ?? null
  );
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
