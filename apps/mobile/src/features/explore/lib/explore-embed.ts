// Web's explore-post-card embed helpers (embedImageUrl, selectPreviewEmbed).
// A post keeps up to five embeds in content order, so an earlier plain link
// must not hide a later YouTube or OG preview: the tile uses the first embed
// that has a visual and falls back to the first embed only when none do.
import { youtubeEmbedThumbnail } from "@/features/feed/lib/link-embeds";
import type { LinkEmbed } from "@/features/feed/lib/link-embeds";

// The raw (unproxied) preview image for an embed, or null for a plain link.
export function embedPreview(embed: LinkEmbed | undefined): string | null {
  if (!embed) {
    return null;
  }
  if (embed.type === "youtube") {
    return youtubeEmbedThumbnail(embed.videoId);
  }
  return embed.imageUrl ?? null;
}

export function selectPreviewEmbed(
  embeds: readonly LinkEmbed[]
): LinkEmbed | undefined {
  return embeds.find((embed) => embedPreview(embed) !== null) ?? embeds[0];
}

// The label web prints in the embed chip and the text row.
export function embedSiteLabel(embed: LinkEmbed): string {
  return embed.siteName || "Link";
}
