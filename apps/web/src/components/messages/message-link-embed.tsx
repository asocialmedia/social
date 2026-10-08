"use client";

import { useQuery } from "@tanstack/react-query";

import { EmbedCard } from "@/components/posts/embeds/embed-card";
import { YouTubeEmbed } from "@/components/posts/embeds/youtube-embed";
import { extractPostUrls } from "@/lib/link-embeds/shared";
import { fetchMessageLinkPreview } from "@/lib/messages/link-preview-loader";
import { postIdFromUrl } from "@/lib/posts/post-url";

import { PostEmbed } from "./post-embed";

// First link in a message body, resolved into a preview card. DMs unfurl only
// the first URL (WhatsApp/iMessage behavior): one request per bubble, a small
// and predictable row height, and a single re-measure when the preview lands.
// Every other link stays a tappable LinkBadge pill inside the text.
//
// The payload is decrypted client-side, so the server never sees the body; the
// URL is resolved at render time through the same rate-limited, SSRF-guarded,
// Redis-cached /api/link-preview endpoint the feed uses at publish time.
export function MessageLinkEmbed({
  content,
  mine,
}: {
  content: string;
  mine: boolean;
}) {
  return <LinkEmbedCard mine={mine} url={extractPostUrls(content)[0] ?? ""} />;
}

// One URL, resolved to a card. Extracted from MessageLinkEmbed so the details
// panel's "Shared links" tab lists the same previews the thread unfurls instead
// of growing a second unfurling path that could drift from this one.
//
// A link that points at an asocialmedia post renders as the rich in-app post
// card instead of a generic external preview, so sharing from the feed and
// pasting the same URL into a chat converge on one look.
//
// `url` is "" when there is nothing to show, which is also what makes this safe
// to render unconditionally: the query stays mounted (hooks must not be
// conditional) and simply never runs.
export function LinkEmbedCard({
  mine,
  url,
  compact = false,
}: {
  mine: boolean;
  url: string;
  compact?: boolean;
}) {
  const internalPostId = url
    ? postIdFromUrl(
        url,
        typeof window === "undefined" ? undefined : window.location.origin
      )
    : null;

  const { data, isError, isLoading } = useQuery({
    // Resolve only once there is an external URL; a text-only message, or one
    // whose first link is an internal post, fires nothing here.
    enabled: Boolean(url) && !internalPostId,
    queryFn: ({ signal }) => fetchMessageLinkPreview(url, signal),
    queryKey: ["message-link-embed", url],
    // Matches the server cache (6h successes, 10m failures); a short client
    // stale window keeps a scrolled-away-and-back bubble from refetching.
    retry: 1,
    staleTime: 30 * 60 * 1000,
  });

  if (internalPostId) {
    return (
      <div className="mt-1.5 max-w-full min-w-0">
        <PostEmbed postId={internalPostId} mine={mine} />
      </div>
    );
  }

  // No URL, or a preview that resolved to nothing: render nothing rather than
  // an empty box. The inline LinkBadge still carries the link.
  if (!url) {
    return null;
  }
  if (isError || data === null) {
    return (
      <div className="mt-1.5 max-w-full min-w-0">
        <EmbedCard
          compact
          embed={{
            siteName: new URL(url).hostname,
            title: url,
            type: "link",
            url,
          }}
        />
      </div>
    );
  }

  // A fixed-height skeleton while resolving, so the card landing does not grow
  // the bubble and force the virtualizer to re-measure mid-scroll.
  if (isLoading || !data) {
    return (
      <div
        className="embed-panel-3d mt-1.5 flex h-24 w-full animate-pulse items-center gap-3 p-3"
        data-message-link-skeleton
      >
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3 w-1/3 rounded bg-current opacity-20" />
          <div className="h-3.5 w-3/4 rounded bg-current opacity-20" />
          <div className="h-3 w-2/3 rounded bg-current opacity-15" />
        </div>
        <div className="size-20 shrink-0 rounded-lg bg-current opacity-15" />
      </div>
    );
  }

  return (
    <div className="mt-1.5 max-w-full min-w-0">
      {!compact && data.type === "youtube" && data.videoId ? (
        <YouTubeEmbed embed={data} />
      ) : (
        <EmbedCard compact embed={data} />
      )}
    </div>
  );
}
