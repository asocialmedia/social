"use client";

import type { LinkEmbed } from "@/lib/link-embeds/shared";

import { EmbedCard } from "./embed-card";
import { YouTubeEmbed } from "./youtube-embed";

// Link previews rendered below a post's content, mirroring how Discord
// surfaces attached links. Payloads are resolved and stored server-side at
// publish time - this component only renders trusted, pre-validated data.

export default function PostLinkEmbeds({ embeds }: { embeds: LinkEmbed[] }) {
  if (!embeds?.length) {
    return null;
  }
  return (
    <div className="mt-2.5 flex flex-col gap-2">
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
