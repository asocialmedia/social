"use client";

import type { UserData } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import { HTTPError } from "ky";
import LinkifyIt from "linkify-it";
import { Hash } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import UserTooltip from "@/components/layouts/user-tooltip";
import kyInstance from "@/lib/ky";
import type { LinkEmbed } from "@/lib/link-embeds/shared";
import { INLINE_TOKEN_PATTERN } from "@/lib/posts/inline-meta";
import { cn } from "@/lib/utils";

import { LinkBadge, findEmbedForUrl } from "./link-badge";

// Post content renderer that turns URLs into inline badges: a YouTube link
// shows the YouTube logo + resolved video title instead of the raw URL.
// @mentions render as profile badges (avatar + @username) and #hashtags as
// tag badges, matching how links render and how the feed's meta chips look.
// Text segments render verbatim (whitespace-pre-wrap on the container keeps
// the author's line breaks), so the author's words are never rewritten -
// only the presentation of the mentions/tags/links they typed.

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
  className,
  content,
  embeds,
}: {
  className?: string;
  content: string;
  embeds?: LinkEmbed[];
}) {
  const segments = segmentContent(content);
  if (segments.length === 0) {
    segments.push({ text: content });
  }
  return (
    <p
      className={cn(
        "text-foreground max-w-full text-[15px] leading-relaxed wrap-break-word whitespace-pre-wrap",
        className
      )}
    >
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

// Renders a plain-text segment with inline mention/tag badges. URLs never
// reach here (they are split out above), so this only decorates the
// author's own @mention and #hashtag tokens.
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
        <InlineMentionBadge
          key={`mention-${(key += 1)}-${username}`}
          username={username}
        />
      );
    } else {
      const tag = token.slice(1);
      nodes.push(
        <InlineHashtagBadge key={`tag-${(key += 1)}-${tag}`} tag={tag} />
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

// Inline @mention badge: the chip treatment from the feed's meta row, with
// the user's profile image. The user is resolved lazily (same cache key as
// the tooltip elsewhere), so the badge upgrades from the default avatar to
// the real one once the lookup lands. Guests get the badge too, just
// without the resolved avatar or hover card.
function InlineMentionBadge({ username }: { username: string }) {
  const { user } = useSession();
  const { data } = useQuery({
    enabled: !!user,
    queryFn: () =>
      kyInstance.get(`/api/users/username/${username}`).json<UserData>(),
    queryKey: ["user-data", username],
    retry(failureCount, error) {
      if (error instanceof HTTPError) {
        const { status } = error.response;
        // Auth failures (401) and missing users (404) won't succeed on retry.
        if (status === 401 || status === 404) {
          return false;
        }
      }
      return failureCount < 2;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

  const badge = (
    <Link
      className="meta-chip meta-chip-mention inline-flex max-w-full items-center gap-1.5 align-middle text-xs"
      href={`/users/${username}`}
      onClick={(event) => event.stopPropagation()}
    >
      <UserAvatar
        avatarUrl={data?.avatarUrl}
        className="h-4 w-4"
        size={16}
        user={data}
      />
      <span className="truncate">@{username}</span>
    </Link>
  );

  if (!data) {
    return badge;
  }
  return <UserTooltip user={data}>{badge}</UserTooltip>;
}

// Inline #hashtag badge, mirroring the feed's tag chip.
function InlineHashtagBadge({ tag }: { tag: string }) {
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
