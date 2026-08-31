"use client";

import { ExternalLink } from "lucide-react";

import type { LinkEmbed } from "@/lib/link-embeds/shared";

import {
  EmbedSiteBadge,
  embedImageProxyUrl,
  useEmbedImageError,
} from "./embed-utils";

// Generic link preview card: origin badge, prettified title, description
// snippet and a proxied thumbnail. The whole card links out with nofollow
// ugc + noopener so crawlers treat it as user content and the origin page
// can never window-opener-attack the viewer.

export function EmbedCard({ embed }: { embed: LinkEmbed }) {
  const image = useEmbedImageError(embed.imageUrl);

  return (
    <a
      className="embed-panel-3d group block overflow-hidden transition-colors duration-150 hover:bg-[hsl(var(--muted))]"
      href={embed.url}
      onClick={(event) => event.stopPropagation()}
      rel="nofollow ugc noopener noreferrer"
      target="_blank"
    >
      <div className="flex items-stretch gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <EmbedSiteBadge siteName={embed.siteName} url={embed.url} />
            <span className="text-muted-foreground truncate text-xs">
              {embed.siteName ?? "Link"}
            </span>
            <ExternalLink className="text-muted-foreground/50 size-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
          </div>
          <p className="text-foreground mt-1 line-clamp-2 text-sm font-medium">
            {embed.title}
          </p>
          {embed.description ? (
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
              {embed.description}
            </p>
          ) : null}
        </div>
        {embed.imageUrl && !image.failed ? (
          // proxied thumbnail; object URLs are impossible here (server
          // resolved), so next/image optimization is skipped for the proxy
          // route the same way avatar proxies are.
          // eslint-disable-next-line @next/next/no-img-element -- dynamic third-party origin, optimizer rejects proxy paths
          <img
            alt=""
            className="border-border/40 h-20 w-20 shrink-0 rounded-lg border object-cover sm:h-24 sm:w-24"
            loading="lazy"
            onError={image.handleError}
            referrerPolicy="no-referrer"
            src={embedImageProxyUrl(embed.imageUrl)}
          />
        ) : null}
      </div>
    </a>
  );
}
