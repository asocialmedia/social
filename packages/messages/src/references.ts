import type { MessagePayload } from "./crypto";

export interface MessageReferenceArtifact {
  kind: "link" | "media" | "post";
  mediaKind?: "gif" | "image";
  ordinal: number;
  requiredId?: string;
  url?: string;
}

const MAX_MESSAGE_LINKS = 5;
const MEDIA_ID_PATTERN = /^\/api\/media\/(?<id>[A-Za-z0-9_-]+)(?:\/|$)/u;
const URL_PATTERN =
  /(?<![\p{L}\p{N}@])(?:https?:\/\/|www\.)[^\s<>"']+|(?<![\p{L}\p{N}@._-])(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?:\/[^\s<>"']*)?/giu;
const TRACKING_PARAM_PATTERN =
  /^(?:utm_[a-z_]+|fbclid|gclid|dclid|msclkid|igsh|igshid|si|ref_src|ref_url|cmpid|spm|scid|twclid|yclid|_hsenc|_hsmi|mc_cid|mc_eid)$/iu;
const KEPT_QUERY_PARAMS = new Set([
  "v",
  "t",
  "start",
  "list",
  "index",
  "abtestid",
]);

function trimUrlPunctuation(value: string): string {
  let candidate = value;
  while (/[.,!?;:]$/u.test(candidate)) {
    candidate = candidate.slice(0, -1);
  }
  while (
    candidate.endsWith(")") &&
    (candidate.match(/\(/gu)?.length ?? 0) <
      (candidate.match(/\)/gu)?.length ?? 0)
  ) {
    candidate = candidate.slice(0, -1);
  }
  return candidate;
}

function sanitizeMessageLink(raw: string): string | null {
  const normalizedInput = /^www\./iu.test(raw) ? `https://${raw}` : raw;
  const withScheme = /^[a-z][a-z\d+.-]*:/iu.test(normalizedInput)
    ? normalizedInput
    : `https://${normalizedInput}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  parsed.username = "";
  parsed.password = "";
  const kept = new URLSearchParams();
  for (const [key, value] of parsed.searchParams) {
    if (
      KEPT_QUERY_PARAMS.has(key.toLowerCase()) ||
      !TRACKING_PARAM_PATTERN.test(key)
    ) {
      kept.append(key, value);
    }
  }
  const query = kept.toString();
  const sanitized = `https://${parsed.host}${parsed.pathname}${query ? `?${query}` : ""}`;
  return sanitized.length <= 2048 ? sanitized : null;
}

function extractMessageLinks(content: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(URL_PATTERN)) {
    if (links.length >= MAX_MESSAGE_LINKS) {
      break;
    }
    const raw = trimUrlPunctuation(match[0]);
    const sanitized = sanitizeMessageLink(raw);
    if (!sanitized || seen.has(sanitized)) {
      continue;
    }
    seen.add(sanitized);
    links.push(sanitized);
  }
  return links;
}

export function extractMessageReferences(
  payload: MessagePayload
): MessageReferenceArtifact[] {
  const references: MessageReferenceArtifact[] = [];
  if (payload.type === "post") {
    if (typeof payload.postId === "string" && payload.postId.length > 0) {
      references.push({ kind: "post", ordinal: 0, requiredId: payload.postId });
    }
  } else if (payload.type === "media") {
    const images = "images" in payload ? payload.images : [payload];
    for (const [ordinal, image] of images.entries()) {
      if (
        typeof image !== "object" ||
        image === null ||
        typeof image.url !== "string" ||
        image.url.length === 0
      ) {
        continue;
      }
      const { url } = image;
      let pathname = url;
      try {
        const parsed = new URL(url, "https://messages.invalid");
        const { pathname: resolvedPathname } = parsed;
        pathname = resolvedPathname;
      } catch {
        continue;
      }
      const mediaId = MEDIA_ID_PATTERN.exec(pathname)?.groups?.id;
      references.push({
        kind: "media",
        mediaKind: payload.kind,
        ordinal,
        ...(mediaId ? { requiredId: mediaId } : {}),
        url,
      });
    }
  }
  const content = typeof payload.content === "string" ? payload.content : "";
  for (const [ordinal, url] of extractMessageLinks(content).entries()) {
    references.push({ kind: "link", ordinal, url });
  }
  return references;
}
