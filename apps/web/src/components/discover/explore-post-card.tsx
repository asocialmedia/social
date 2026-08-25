"use client";

import type { Media, PostData } from "@asm/db";
import noMediaImage from "@assets/general/nomedia.png";
import { Clapperboard, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { useState } from "react";

import UserAvatar from "@/components/layouts/user-avatar";
import UserBadge from "@/components/layouts/user-badge";
import AuraVoteButton from "@/components/posts/aura-vote-button";
import ModeratedNotice from "@/components/posts/moderated-notice";
import { cn } from "@/lib/utils";
import { getMediaImageSrcSet, getMediaProxyUrl } from "@/lib/utils/image-url";

const DEFAULT_ASPECT = 4 / 5;

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

interface ExplorePostCardProps {
  post: PostData;
}

const ExplorePostCard: React.FC<ExplorePostCardProps> = ({ post }) => {
  const media = post.attachments.find(
    (attachment) => attachment.type === "IMAGE" || attachment.type === "VIDEO"
  );
  const isGustPost = Boolean(post.isGust);
  let aspectRatio = DEFAULT_ASPECT;
  if (isGustPost) {
    aspectRatio = 9 / 16;
  } else if (media?.width && media?.height) {
    aspectRatio = media.width / media.height;
  }
  const href = isGustPost ? `/gusts?id=${post.id}` : `/posts/${post.id}`;

  let mediaContent: React.ReactNode = null;
  if (media?.type === "IMAGE") {
    mediaContent = <ExplorePostImage media={media} />;
  } else if (media) {
    mediaContent = <ExplorePostVideo media={media} />;
  }

  // A moderated post never shows its media or content on the explore surface.
  if (post.moderated) {
    return (
      <article className="sidebar-subcard group mb-4 break-inside-avoid overflow-hidden rounded-2xl p-3 transition-colors duration-150 hover:bg-[hsl(var(--muted))]">
        <ModeratedNotice kind={isGustPost ? "gust" : "post"} />
      </article>
    );
  }

  // Explicit media is just blurred in explore - no gate popup, the content
  // stays hidden until the post is opened.
  return (
    <article className="sidebar-subcard group mb-4 break-inside-avoid overflow-hidden rounded-2xl transition-colors duration-150 hover:bg-[hsl(var(--muted))]">
      <Link className="block" href={href}>
        {media ? (
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
              avatarUrl={post.user.avatarUrl}
              className="h-8 w-8"
              user={post.user}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="truncate text-xs font-medium">
                  {post.user.displayName || post.user.username}
                </span>
                <UserBadge badge={post.user.badge} badges={post.user.badges} />
              </div>
              <p className="text-muted-foreground truncate text-[11px]">
                @{post.user.username}
              </p>
            </div>
          </div>
        </div>
      </Link>

      <div className="text-muted-foreground flex flex-nowrap items-center gap-2 overflow-x-hidden px-3 pb-3 text-xs">
        <AuraVoteButton
          authorName={post.user.displayName}
          expandable={false}
          initialState={{
            aura: post.aura,
            userVote: post.vote[0]?.value || 0,
          }}
          postId={post.id}
        />
      </div>
    </article>
  );
};

export default ExplorePostCard;
