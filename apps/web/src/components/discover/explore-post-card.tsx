"use client";

import type { PostData } from "@asm/db";
import { Clapperboard, ImageOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { useState } from "react";

import UserAvatar from "@/components/layouts/user-avatar";
import UserBadge from "@/components/layouts/user-badge";
import AuraVoteButton from "@/components/posts/aura-vote-button";
import { cn } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

const getMediaUrl = (mediaId: string) => `/api/media/${mediaId}`;

const DEFAULT_ASPECT = 4 / 5;

const ExplorePostImage: React.FC<{ mediaId: string }> = ({ mediaId }) => {
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [isImageFailed, setIsImageFailed] = useState(false);

  if (isImageFailed) {
    return (
      <div className="border-border/60 bg-muted/20 text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-1.5 border border-dashed p-4 text-center text-xs">
        <ImageOff className="h-6 w-6 opacity-60" />
        <span className="text-[11px]">Failed to load</span>
      </div>
    );
  }

  return (
    <>
      {isImageLoading ? (
        <div className="bg-muted/40 absolute inset-0 animate-pulse" />
      ) : null}
      <Image
        alt="Post media"
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
        src={getMediaUrl(mediaId)}
        unoptimized
      />
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
    mediaContent = <ExplorePostImage mediaId={media.id} />;
  } else if (media) {
    mediaContent = (
      <video
        aria-label="Post video"
        autoPlay
        className="absolute inset-0 h-full w-full object-cover"
        loop
        muted
        playsInline
        poster={getMediaProxyUrl(media)}
        preload="metadata"
        src={getMediaUrl(media.id)}
      />
    );
  }

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
            {mediaContent}
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
                <UserBadge badge={post.user.badge} />
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
