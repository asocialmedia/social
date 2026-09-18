"use client";

import type { LinkEmbed } from "@/lib/link-embeds/shared";
import { cn } from "@/lib/utils";

import { EmbedCard } from "./embed-card";
import { YouTubeEmbed } from "./youtube-embed";

// Link previews rendered below a post's content, mirroring how Discord
// surfaces attached links. Payloads are resolved and stored server-side at
// publish time - this component only renders trusted, pre-validated data.

export default function PostLinkEmbeds({
  className,
  embeds,
}: {
  // Spacing override. The default `mt-2.5` is the gap below the content (or
  // the media block); a caller grouping embeds with media into one flex column
  // passes `className=""` and lets the column own the spacing.
  className?: string;
  embeds: LinkEmbed[];
}) {
  if (!embeds?.length) {
    return null;
  }
  return (
    // `mt-2.5` is the default gap below the content (or media block). A caller
    // that groups embeds into its own flex column passes a `className` (even an
    // empty string) and owns the spacing; `cn` cannot cancel a class with an
    // empty string, so the default is applied only when no className is given.
    <div className={cn("flex flex-col gap-2", className ?? "mt-2.5")}>
      {embeds
        .slice(0, 5)
        .map((embed) =>
          embed.type === "youtube" && embed.videoId ? (
            <YouTubeEmbed embed={embed} key={embed.url} />
          ) : (
            <EmbedCard embed={embed} key={embed.url} />
          )
        )}
    </div>
  );
}
