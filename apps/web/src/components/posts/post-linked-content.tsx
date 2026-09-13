"use client";

import LinkifyIt from "linkify-it";
import Link from "next/link";
import type { ReactNode } from "react";

import UserLinkWithTooltip from "@/components/layouts/user-link-with-tooltip";
import type { LinkEmbed } from "@/lib/link-embeds/shared";

import { LinkBadge, findEmbedForUrl } from "./link-badge";

// Post content renderer that turns URLs into inline badges: a YouTube link
// shows the YouTube logo + resolved video title instead of the raw URL.
// @mentions and #hashtags stay inline in the author's text (like comments)
// and render as links, while the PostMeta chips below keep working from the
// stored mention/tag relations. Text segments render verbatim
// (whitespace-pre-wrap on the container keeps the author's line breaks), so
// the author's words are never rewritten - only the presentation of the
// links they typed.

const linkify = new LinkifyIt();

// Same shapes as the comment Linkify helper so posts and comments agree.
const INLINE_TOKEN_PATTERN = /(?<token>@[a-zA-Z0-9_-]+|#[a-zA-Z0-9]+)/g;

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
          <InlineRichText key={`text-${index}`} text={segment.text ?? ""} />
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

// Renders a plain-text segment with inline @mention and #hashtag links.
// URLs never reach here (they are split out above), so this only decorates
// the author's own mention/tag tokens.
function InlineRichText({ text }: { text: string }) {
  if (!text) {
    return null;
  }
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE_TOKEN_PATTERN)) {
    const [token] = match;
    const matchIndex = match.index ?? -1;
    if (matchIndex < 0) {
      continue;
    }
    if (matchIndex > cursor) {
      nodes.push(text.slice(cursor, matchIndex));
    }
    if (token.startsWith("@")) {
      const username = token.slice(1);
      nodes.push(
        <UserLinkWithTooltip
          key={`mention-${(key += 1)}-${username}`}
          username={username}
        >
          {token}
        </UserLinkWithTooltip>
      );
    } else {
      const tag = token.slice(1);
      nodes.push(
        <Link
          className="text-primary hover:underline"
          href={`/hashtag/${tag}`}
          key={`tag-${(key += 1)}-${tag}`}
        >
          {token}
        </Link>
      );
    }
    cursor = matchIndex + token.length;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  if (nodes.length === 0) {
    return text;
  }
  return nodes;
}
