import type { TextSegment } from "@asm/protocols/contracts";

import type { BioSegment } from "@/features/home/components/profile-utils";

export function externalInlineSegments(source: TextSegment[]): BioSegment[] {
  const result: BioSegment[] = [];
  for (const segment of source) {
    if (segment.href) {
      if (segment.text.startsWith("@")) {
        const match = /(?:bsky\.app\/profile\/|^at:\/\/)(?<actor>[^/?#]+)/.exec(
          segment.href
        );
        const username = segment.text.replace(/^@/, "");
        result.push({
          actor: match?.groups?.actor ? decodeURIComponent(match[1]) : username,
          type: "mention",
          username,
        });
      } else if (segment.text.startsWith("#")) {
        result.push({ tag: segment.text.replace(/^#/, ""), type: "tag" });
      } else {
        result.push({ label: segment.text, type: "url", url: segment.href });
      }
      continue;
    }
    const pattern = /@[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+|#[\p{L}\p{N}_-]+/gu;
    let cursor = 0;
    for (const match of segment.text.matchAll(pattern)) {
      if (match.index > cursor) {
        result.push({
          text: segment.text.slice(cursor, match.index),
          type: "text",
        });
      }
      const [token] = match;
      if (token.startsWith("@")) {
        result.push({
          actor: token.slice(1),
          type: "mention",
          username: token.slice(1),
        });
      } else {
        result.push({ tag: token.slice(1), type: "tag" });
      }
      cursor = match.index + token.length;
    }
    if (cursor < segment.text.length) {
      result.push({ text: segment.text.slice(cursor), type: "text" });
    }
  }
  return result;
}
