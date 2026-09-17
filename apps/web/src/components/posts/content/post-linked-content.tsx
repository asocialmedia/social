"use client";

import type { UserData } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import { HTTPError } from "ky";

import { useSession } from "@/app/(main)/session-provider";
import UserTooltip from "@/components/layouts/user/user-tooltip";
import kyInstance from "@/lib/ky";
import type { LinkEmbed } from "@/lib/link-embeds/shared";

import { InlineMentionChip, PostInlineContent } from "./post-inline-content";

// Post content with tooltip-enriched mentions. The rendering itself lives in
// PostInlineContent (which has no UserTooltip dependency, so the tooltip's own
// bio can reuse it); this wrapper only supplies the mention renderer that
// resolves the mentioned user and wraps the chip in a hover card.

export default function PostLinkedContent({
  className,
  content,
  embeds,
  linkBadge = "preview",
}: {
  className?: string;
  content: string;
  embeds?: LinkEmbed[];
  linkBadge?: "chip" | "preview";
}) {
  return (
    <PostInlineContent
      className={className}
      content={content}
      embeds={embeds}
      linkBadge={linkBadge}
      renderMention={(username) => <TooltipMention username={username} />}
    />
  );
}

// Inline @mention chip with a profile hover card. The user is resolved lazily
// (same cache key the tooltip uses elsewhere), so the chip upgrades from the
// default avatar to the real one once the lookup lands. Guests get the chip
// too, just without the resolved avatar or hover card.
function TooltipMention({ username }: { username: string }) {
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

  const chip = (
    <InlineMentionChip
      avatarUrl={data?.avatarUrl}
      user={data}
      username={username}
    />
  );

  if (!data) {
    return chip;
  }
  return <UserTooltip user={data}>{chip}</UserTooltip>;
}
