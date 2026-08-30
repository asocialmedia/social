"use client";

import { useQueries } from "@tanstack/react-query";

import { EmbedCard } from "@/components/posts/embed-card";
import { YouTubeEmbed } from "@/components/posts/youtube-embed";
import kyInstance from "@/lib/ky";
import { extractPostUrls, MAX_POST_EMBEDS } from "@/lib/link-embeds/shared";
import type { LinkEmbed } from "@/lib/link-embeds/shared";

interface CommentLinkEmbedsProps {
  content: string;
}

interface LinkPreviewResponse {
  embed: LinkEmbed;
}

export function CommentLinkEmbeds({ content }: CommentLinkEmbedsProps) {
  const urls = extractPostUrls(content);

  const queries = useQueries({
    queries: urls.map((url) => ({
      enabled: Boolean(url),
      queryFn: async (): Promise<LinkEmbed | null> => {
        try {
          const response = await kyInstance
            .get("/api/link-preview", {
              searchParams: { url },
              timeout: 10_000,
            })
            .json<LinkPreviewResponse>();
          return response.embed;
        } catch {
          return null;
        }
      },
      queryKey: ["link-preview", url],
      retry: 1,
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });

  if (urls.length === 0) {
    return null;
  }

  const embeds = queries
    .map((q) => q.data)
    .filter((embed): embed is LinkEmbed => Boolean(embed))
    .slice(0, MAX_POST_EMBEDS);

  if (embeds.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {embeds.map((embed) =>
        embed.type === "youtube" && embed.videoId ? (
          <YouTubeEmbed embed={embed} key={embed.url} />
        ) : (
          <EmbedCard embed={embed} key={embed.url} />
        )
      )}
    </div>
  );
}
