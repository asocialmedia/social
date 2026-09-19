"use client";

import type { Media, PostData } from "@asm/db";
import noMediaImage from "@assets/general/nomedia.png";
import { Clapperboard, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { useState } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import UserBadge from "@/components/layouts/user/user-badge";
import AuraVoteButton from "@/components/posts/actions/aura-vote-button";
import ModeratedNotice from "@/components/posts/content/moderated-notice";
import {
  EmbedSiteBadge,
  embedImageProxyUrl,
  useEmbedImageError,
  youtubeEmbedThumbnail,
} from "@/components/posts/embeds/embed-utils";
import { parseStoredEmbeds } from "@/lib/link-embeds/shared";
import type { LinkEmbed } from "@/lib/link-embeds/shared";
import { getPostPath } from "@/lib/seo/seo";
import { cn } from "@/lib/utils";
import { getMediaImageSrcSet, getMediaProxyUrl } from "@/lib/utils/image-url";

const DEFAULT_ASPECT = 4 / 5;
// Link previews are landscape (YouTube's hqdefault is 16:9; OG cards are
// typically ~1.91:1), so an embed tile uses a landscape frame instead of the
// portrait default the native-media tiles fall back to.
const EMBED_ASPECT = 16 / 9;

const ExplorePostImage: React.FC<{ media: Media }> = ({ media }) => {
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [isImageFailed, setIsImageFailed] = useState(false);

  if (isImageFailed) {
    return (
      <Image
        alt="Post media unavailable"
        className="h-full w-full object-cover opacity-60"
        fill
        sizes="(max-width: 768px) 50vw, 300px"
        src={noMediaImage}
        unoptimized
      />
    );
  }

  return (
    <>
      {isImageLoading ? (
        <div className="bg-muted/40 absolute inset-0 animate-pulse" />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- srcSet for responsive explore tiles */}
      <img
        alt="Post media"
        className={cn(
          "absolute inset-0 h-full w-full object-cover transition-all duration-300 group-hover:scale-105",
          isImageLoading ? "opacity-0" : "opacity-100"
        )}
        decoding="async"
        loading="lazy"
        onError={() => {
          setIsImageFailed(true);
          setIsImageLoading(false);
        }}
        onLoad={() => setIsImageLoading(false)}
        sizes="(max-width: 768px) 50vw, 300px"
        src={getMediaProxyUrl(media)}
        srcSet={getMediaImageSrcSet(media)}
      />
    </>
  );
};

const ExplorePostVideo: React.FC<{
  media: NonNullable<PostData["attachments"][number]>;
}> = ({ media }) => {
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [isImageFailed, setIsImageFailed] = useState(false);

  if (isImageFailed) {
    return (
      <Image
        alt="Post video unavailable"
        className="h-full w-full object-cover opacity-60"
        fill
        sizes="(max-width: 768px) 50vw, 300px"
        src={noMediaImage}
        unoptimized
      />
    );
  }

  return (
    <>
      {isImageLoading ? (
        <div className="bg-muted/40 absolute inset-0 animate-pulse" />
      ) : null}
      <Image
        alt="Post video preview"
        className={cn(
          "object-cover transition-all duration-300 group-hover:scale-105",
          isImageLoading ? "opacity-0" : "opacity-100"
        )}
        fill
        onError={() => {
          setIsImageFailed(true);
          setIsImageLoading(false);
        }}
        onLoad={() => setIsImageLoading(false)}
        sizes="(max-width: 768px) 50vw, 300px"
        src={getMediaProxyUrl(media)}
        unoptimized
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/30">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-md transition-transform group-hover:scale-110">
          <Play className="ml-0.5 h-5 w-5 fill-white text-white" />
        </div>
      </div>
    </>
  );
};

// The previewable image for a link embed, if any. YouTube derives its poster
// from the validated video id; a generic link uses its OG image. Null means the
// embed has no visual (a plain link), which renders as a text row instead.
export function embedImageUrl(embed: LinkEmbed): string | null {
  if (embed.type === "youtube") {
    return youtubeEmbedThumbnail(embed.videoId);
  }
  return embed.imageUrl ?? null;
}

// Posts preserve up to five embeds in content order, so an earlier plain link
// must not hide a later YouTube/OG preview: pick the first embed that actually
// has a visual, falling back to the first embed only when none are visual.
export function selectPreviewEmbed(embeds: LinkEmbed[]): LinkEmbed | undefined {
  return (
    embeds.find((candidate) => embedImageUrl(candidate) !== null) ?? embeds[0]
  );
}

// A link embed's visual for the masonry tile. The image is always served
// through the SSRF-guarded proxy (raw third-party URLs never reach the
// browser), and on load failure it falls back to the embed's text row so the
// tile still communicates that it holds a link.
export const ExplorePostEmbed: React.FC<{ embed: LinkEmbed }> = ({ embed }) => {
  const rawImage = embedImageUrl(embed);
  // `failed` is already true when there is no image at all, so this one check
  // covers both "plain link" and "image that would not load".
  const image = useEmbedImageError(rawImage);

  if (image.failed || !rawImage) {
    return (
      <div className="flex h-full w-full flex-col justify-end gap-1 p-3">
        <div className="flex items-center gap-1.5">
          <EmbedSiteBadge siteName={embed.siteName} url={embed.url} />
          <span className="text-muted-foreground truncate text-[11px]">
            {embed.siteName ?? "Link"}
          </span>
        </div>
        <p className="line-clamp-3 text-sm leading-snug font-medium">
          {embed.title}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- proxied OG/YouTube thumbnail for responsive explore tiles */}
      <img
        alt={embed.title}
        className="absolute inset-0 h-full w-full object-cover transition-all duration-300 group-hover:scale-105"
        decoding="async"
        loading="lazy"
        onError={image.handleError}
        sizes="(max-width: 768px) 50vw, 300px"
        src={embedImageProxyUrl(rawImage)}
      />
      {/* Platform mark, mirroring the "Gust" chip's placement on a gust tile. */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-white backdrop-blur-md">
        <EmbedSiteBadge siteName={embed.siteName} url={embed.url} />
        <span className="text-[10px] font-semibold">
          {embed.siteName ?? "Link"}
        </span>
      </div>
    </>
  );
};

interface ExplorePostCardProps {
  post: PostData;
}

const ExplorePostCard: React.FC<ExplorePostCardProps> = ({ post }) => {
  const media = post.attachments?.find(
    (attachment) => attachment.type === "IMAGE" || attachment.type === "VIDEO"
  );
  const isGustPost = Boolean(post.isGust);
  // Link embeds are a first-class visual here, like native media: a text-only
  // post that carries a YouTube/OG preview would otherwise render as a bare
  // paragraph tile, hiding the preview it actually has.
  const embed = selectPreviewEmbed(parseStoredEmbeds(post.embeds));
  const hasEmbed = Boolean(embed);
  let aspectRatio = DEFAULT_ASPECT;
  if (isGustPost) {
    aspectRatio = 9 / 16;
  } else if (media?.width && media?.height) {
    aspectRatio = media.width / media.height;
  } else if (hasEmbed) {
    aspectRatio = EMBED_ASPECT;
  }
  const href = getPostPath(post);

  let mediaContent: React.ReactNode = null;
  if (media?.type === "IMAGE") {
    mediaContent = <ExplorePostImage media={media} />;
  } else if (media) {
    mediaContent = <ExplorePostVideo media={media} />;
  } else if (embed) {
    mediaContent = <ExplorePostEmbed embed={embed} />;
  }

  // The visual frame shows whenever there is anything to show: native media, or
  // a link embed.
  const hasVisual = Boolean(media) || hasEmbed;

  // A moderated post never shows its media or content on the explore surface.
  if (post.moderated) {
    return (
      <article
        className="sidebar-subcard group mb-4 break-inside-avoid overflow-hidden rounded-2xl p-3 transition-colors duration-150 hover:bg-[hsl(var(--muted))]"
        data-post-id={post.id}
      >
        <ModeratedNotice kind={isGustPost ? "gust" : "post"} />
      </article>
    );
  }

  // Explicit media is just blurred in explore - no gate popup, the content
  // stays hidden until the post is opened.
  return (
    <article
      className="sidebar-subcard group mb-4 break-inside-avoid overflow-hidden rounded-2xl transition-colors duration-150 hover:bg-[hsl(var(--muted))]"
      data-post-id={post.id}
    >
      <Link className="block" href={href}>
        {hasVisual ? (
          <div
            className="bg-muted/20 relative w-full overflow-hidden"
            style={{ aspectRatio }}
          >
            {isGustPost ? (
              <div className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white backdrop-blur-md">
                <Clapperboard className="text-primary size-3" />
                <span className="text-[10px] font-semibold">Gust</span>
              </div>
            ) : null}
            <div
              className={cn(
                "h-full w-full",
                post.explicitContent && "opacity-60 blur-lg saturate-50"
              )}
            >
              {mediaContent}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-2.5 p-3">
          <p className="line-clamp-4 text-sm leading-snug">{post.content}</p>

          <div className="flex items-center gap-2">
            <UserAvatar
              avatarUrl={post.user?.avatarUrl}
              className="h-8 w-8"
              user={post.user}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="truncate text-xs font-medium">
                  {post.user?.displayName || post.user?.username || "Anonymous"}
                </span>
                <UserBadge
                  badge={post.user?.badge}
                  badges={post.user?.badges}
                  communityRoles={post.user?.communityMemberships}
                />
              </div>
              <p className="text-muted-foreground truncate text-[11px]">
                @{post.user?.username || "unknown"}
              </p>
            </div>
          </div>
        </div>
      </Link>

      <div className="text-muted-foreground flex flex-nowrap items-center gap-2 overflow-x-hidden px-3 pb-3 text-xs">
        <AuraVoteButton
          authorName={post.user?.displayName || post.user?.username}
          expandable={false}
          initialState={{
            aura: post.aura ?? 0,
            userVote: post.vote?.[0]?.value ?? 0,
          }}
          postId={post.id}
        />
      </div>
    </article>
  );
};

export default ExplorePostCard;
