"use client";

import LinkifyIt from "linkify-it";

import type { LinkEmbed } from "@/lib/link-embeds/shared";

import { LinkBadge, findEmbedForUrl } from "./link-badge";

// Post content renderer that turns URLs into inline badges: a YouTube link
// shows the YouTube logo + resolved video title instead of the raw URL.
// Text segments render verbatim (whitespace-pre-wrap on the container keeps
// the author's line breaks), so the author's words are never rewritten -
// only the presentation of the links they typed.

const linkify = new LinkifyIt();

interface ContentSegment {
  text?: string;
  url?: string;
}

function segmentContent(content: string): ContentSegment[] {
  const matches = linkify.match(content) ?? [];
  const segments: ContentSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index > cursor) {
      segments.push({ text: content.slice(cursor, match.index) });
    }
    segments.push({ url: match.url });
    cursor = match.lastIndex;
  }
  if (cursor < content.length) {
    segments.push({ text: content.slice(cursor) });
  }
  return segments;
}

export default function PostLinkedContent({
  content,
  embeds,
}: {
  content: string;
  embeds?: LinkEmbed[];
}) {
  const segments = segmentContent(content);
  if (segments.length === 0) {
    segments.push({ text: content });
  }
  return (
    <p className="text-foreground max-w-full text-[15px] leading-relaxed wrap-break-word whitespace-pre-wrap">
      {segments.map((segment, index) =>
        segment.url === undefined ? (
          segment.text
        ) : (
          <LinkBadge
            key={`${segment.url}-${index}`}
            title={findEmbedForUrl(segment.url, embeds)?.title}
            url={segment.url}
          />
        )
      )}
    </p>
  );
}
