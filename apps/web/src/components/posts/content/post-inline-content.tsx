"use client";

import type { TextSegment } from "@asm/protocols/contracts";
import LinkifyIt from "linkify-it";
import { Hash } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import type { LinkEmbed } from "@/lib/link-embeds/shared";
import { INLINE_TOKEN_PATTERN } from "@/lib/posts/inline-meta";
import { blueskyProfilePath } from "@/lib/protocols/paths";
import { cn } from "@/lib/utils";

import { LinkBadge, findEmbedForUrl, hostLabel } from "../embeds/link-badge";

// The shared inline renderer for authored text: URLs become link badges,
// @mentions and #hashtags become the same chips the feed's meta row uses, and
// everything else renders verbatim (whitespace-pre-wrap keeps the author's line
// breaks, so their words are never rewritten - only how the tokens they typed
// are presented).
//
// Lives apart from PostLinkedContent so it carries NO dependency on
// UserTooltip. PostLinkedContent wraps mentions in a hover card, and the
// tooltip's own bio needs this renderer - keeping them in one file created an
// import cycle (post-linked-content -> user-tooltip -> post-linked-content).
// Callers that want enriched mentions pass `renderMention`.

const linkify = new LinkifyIt();
const EXTERNAL_INLINE_TOKEN_PATTERN =
  /@[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+|#[\p{L}\p{N}_-]+/gu;
const BLANK_LINE_PATTERN = /\r?\n(?:[\t ]*\r?\n)+/;
const COMPACT_INLINE_TOKEN_PATTERN = new RegExp(
  `${INLINE_TOKEN_PATTERN.source}|${BLANK_LINE_PATTERN.source}`,
  "gu"
);
const COMPACT_EXTERNAL_INLINE_TOKEN_PATTERN = new RegExp(
  `${EXTERNAL_INLINE_TOKEN_PATTERN.source}|${BLANK_LINE_PATTERN.source}`,
  "gu"
);

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

// The plain @mention chip: the feed's meta-chip treatment with an avatar. No
// hover card and no lookup - callers that have the user (or want a tooltip)
// wrap this themselves via `renderMention`.
export function InlineMentionChip({
  avatarUrl,
  href,
  user,
  username,
}: {
  avatarUrl?: string | null;
  href?: string;
  // Mirrors UserAvatar's own `user` prop shape (avatarUrl required when
  // present) so a resolved UserData passes through without a cast.
  user?: {
    avatarUrl: string | null;
    id?: string;
    username?: string;
  } | null;
  username: string;
}) {
  return (
    <Link
      className="meta-chip meta-chip-mention inline-flex max-w-full items-center gap-1.5 align-middle text-xs"
      href={href ?? `/users/${username}`}
      onClick={(event) => event.stopPropagation()}
    >
      <UserAvatar
        avatarUrl={avatarUrl}
        className="h-4 w-4"
        size={16}
        user={user}
      />
      <span className="truncate">@{username}</span>
    </Link>
  );
}

// Inline #hashtag chip, mirroring the feed's tag chip.
export function InlineHashtagChip({ tag }: { tag: string }) {
  return (
    <Link
      className="meta-chip meta-chip-tag inline-flex max-w-full items-center gap-1.5 align-middle text-xs"
      href={`/hashtag/${tag}`}
      onClick={(event) => event.stopPropagation()}
    >
      <Hash className="meta-chip-accent h-3.5 w-3.5" />
      <span className="truncate">{tag}</span>
    </Link>
  );
}

export function PostInlineContent({
  className,
  compactBlankLines = false,
  content,
  embeds,
  linkBadge = "preview",
  renderMention,
  sourceSegments,
  source,
}: {
  sourceSegments?: TextSegment[];
  source?: "asm" | "bluesky";
  className?: string;
  compactBlankLines?: boolean;
  content: string;
  embeds?: LinkEmbed[];
  // "preview" resolves the embed title (post cards); "chip" renders the badge
  // with just the host label and never fetches (profile bios).
  linkBadge?: "chip" | "preview";
  // Replaces the plain mention chip, e.g. to attach a hover card. Receives the
  // username and returns the node to render in its place.
  renderMention?: (username: string) => ReactNode;
}) {
  const segments = sourceSegments
    ? sourceSegments.map((segment) => ({
        text: segment.text,
        url: segment.href,
      }))
    : segmentContent(content);
  if (segments.length === 0) {
    segments.push({ text: content });
  }
  return (
    <p
      className={cn(
        // `post-prose` scopes the inline-chip sizing in globals.css: chips in
        // flowing text need slimmer metrics plus a vertical margin, or wrapped
        // lines collide.
        "post-prose text-foreground max-w-full text-[15px] leading-relaxed wrap-break-word whitespace-pre-wrap",
        className
      )}
    >
      {segments.map((segment, index) => {
        if (segment.url === undefined) {
          return (
            <InlineRichText
              key={`text-${index}`}
              compactBlankLines={compactBlankLines}
              external={Boolean(sourceSegments) || source === "bluesky"}
              renderMention={
                sourceSegments || source === "bluesky"
                  ? (username) => (
                      <InlineMentionChip
                        href={blueskyProfilePath(username)}
                        username={username}
                      />
                    )
                  : renderMention
              }
              text={segment.text ?? ""}
            />
          );
        }
        if (sourceSegments && segment.text?.startsWith("@")) {
          const destination = new URL(segment.url);
          if (
            destination.hostname === "bsky.app" &&
            destination.pathname.startsWith("/profile/")
          ) {
            const actor = decodeURIComponent(
              destination.pathname.slice("/profile/".length)
            );
            return (
              <InlineMentionChip
                key={`mention-${index}`}
                href={blueskyProfilePath(actor)}
                username={segment.text.slice(1)}
              />
            );
          }
        }
        let title = findEmbedForUrl(segment.url, embeds)?.title;
        if (linkBadge === "chip") {
          title = hostLabel(segment.url);
        }
        return (
          <LinkBadge
            index={index}
            key={`${segment.url}-${index}`}
            title={title}
            url={segment.url}
          />
        );
      })}
    </p>
  );
}

// One @mention token. A component rather than a plain node so the loop above
// can key it directly; that keeps the chip's exact DOM (no wrapper element to
// disturb the baseline alignment the meta-chip relies on) and avoids
// cloneElement, which lint rightly discourages.
function InlineMention({
  renderMention,
  username,
}: {
  renderMention?: (username: string) => ReactNode;
  username: string;
}) {
  if (renderMention) {
    return renderMention(username);
  }
  return <InlineMentionChip username={username} />;
}

// Renders a plain-text segment with inline mention/tag chips. URLs never reach
// here (they are split out above), so this only decorates the author's own
// @mention and #hashtag tokens.
function InlineRichText({
  text,
  renderMention,
  external = false,
  compactBlankLines = false,
}: {
  text: string;
  external?: boolean;
  compactBlankLines?: boolean;
  renderMention?: (username: string) => ReactNode;
}) {
  if (!text) {
    return null;
  }
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let tokenPattern = external
    ? EXTERNAL_INLINE_TOKEN_PATTERN
    : INLINE_TOKEN_PATTERN;
  if (compactBlankLines) {
    tokenPattern = external
      ? COMPACT_EXTERNAL_INLINE_TOKEN_PATTERN
      : COMPACT_INLINE_TOKEN_PATTERN;
  }
  for (const match of text.matchAll(tokenPattern)) {
    const [token] = match;
    const matchIndex = match.index ?? -1;
    if (matchIndex < 0) {
      continue;
    }
    if (matchIndex > cursor) {
      nodes.push(text.slice(cursor, matchIndex));
    }
    if (token.startsWith("\n") || token.startsWith("\r")) {
      nodes.push(
        <span
          className="block h-2 whitespace-normal"
          key={`break-${(key += 1)}`}
        >
          {token}
        </span>
      );
    } else if (token.startsWith("@")) {
      const username = token.slice(1);
      nodes.push(
        <InlineMention
          key={`mention-${(key += 1)}-${username}`}
          renderMention={renderMention}
          username={username}
        />
      );
    } else {
      const tag = token.slice(1);
      nodes.push(
        <InlineHashtagChip key={`tag-${(key += 1)}-${tag}`} tag={tag} />
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
