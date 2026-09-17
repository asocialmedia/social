"use client";

import LinkifyIt from "linkify-it";
import { Hash } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import type { LinkEmbed } from "@/lib/link-embeds/shared";
import { INLINE_TOKEN_PATTERN } from "@/lib/posts/inline-meta";
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
  user,
  username,
}: {
  avatarUrl?: string | null;
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
      href={`/users/${username}`}
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
  content,
  embeds,
  linkBadge = "preview",
  renderMention,
}: {
  className?: string;
  content: string;
  embeds?: LinkEmbed[];
  // "preview" resolves the embed title (post cards); "chip" renders the badge
  // with just the host label and never fetches (profile bios).
  linkBadge?: "chip" | "preview";
  // Replaces the plain mention chip, e.g. to attach a hover card. Receives the
  // username and returns the node to render in its place.
  renderMention?: (username: string) => ReactNode;
}) {
  const segments = segmentContent(content);
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
      {segments.map((segment, index) =>
        segment.url === undefined ? (
          <InlineRichText
            key={`text-${index}`}
            renderMention={renderMention}
            text={segment.text ?? ""}
          />
        ) : (
          <LinkBadge
            key={`${segment.url}-${index}`}
            title={
              linkBadge === "chip"
                ? hostLabel(segment.url)
                : findEmbedForUrl(segment.url, embeds)?.title
            }
            url={segment.url}
          />
        )
      )}
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
}: {
  text: string;
  renderMention?: (username: string) => ReactNode;
}) {
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
