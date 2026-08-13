"use client";

import type { PostData } from "@asm/db";
import { Eye } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import UserAvatar from "@/components/layouts/user-avatar";
import AuraVoteButton from "@/components/posts/aura-vote-button";
import { formatNumber } from "@/lib/utils";

const getMediaUrl = (mediaId: string) => `/api/media/${mediaId}`;

const DEFAULT_ASPECT = 4 / 5;

interface ExplorePostCardProps {
  post: PostData;
}

const ExplorePostCard: React.FC<ExplorePostCardProps> = ({ post }) => {
  const media = post.attachments.find(
    (attachment) => attachment.type === "IMAGE" || attachment.type === "VIDEO"
  );
  const aspectRatio =
    media?.width && media?.height ? media.width / media.height : DEFAULT_ASPECT;

  return (
    <article className="sidebar-subcard group mb-4 break-inside-avoid overflow-hidden rounded-2xl transition-colors duration-150 hover:bg-[hsl(var(--muted))]">
      <Link className="block" href={`/posts/${post.id}`}>
        {media ? (
          <div
            className="relative w-full overflow-hidden"
            style={{ aspectRatio }}
          >
            {media.type === "IMAGE" ? (
              <Image
                alt="Post media"
                className="object-cover transition-transform duration-300 group-hover:scale-105"
                fill
                sizes="(max-width: 768px) 50vw, 300px"
                src={getMediaUrl(media.id)}
                unoptimized
              />
            ) : (
              <video
                aria-label="Post video"
                autoPlay
                className="absolute inset-0 h-full w-full object-cover"
                loop
                muted
                playsInline
                preload="metadata"
                src={getMediaUrl(media.id)}
              />
            )}
          </div>
        ) : null}

        <div className="flex flex-col gap-2.5 p-3">
          <p className="line-clamp-4 text-sm leading-snug">{post.content}</p>

          <div className="flex items-center gap-2">
            <UserAvatar avatarUrl={post.user.avatarUrl} className="h-6 w-6" />
            <span className="truncate font-medium text-xs">
              {post.user.displayName || post.user.username}
            </span>
          </div>
        </div>
      </Link>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-3 text-muted-foreground text-xs">
        <AuraVoteButton
          authorName={post.user.displayName}
          expandable={false}
          initialState={{
            aura: post.aura,
            userVote: post.vote[0]?.value || 0,
          }}
          postId={post.id}
        />
        <span className="flex items-center gap-1">
          <Eye className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">
            {formatNumber(post.viewCount)}
          </span>
        </span>
      </div>
    </article>
  );
};

export default ExplorePostCard;
