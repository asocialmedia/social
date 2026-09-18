// oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions

import type { PostParentData } from "@asm/db";
import { ImageOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import UserBadge from "@/components/layouts/user/user-badge";
import PostLinkedContent from "@/components/posts/content/post-linked-content";
import PostLinkEmbeds from "@/components/posts/embeds/link-embeds";
import { isInteractiveTarget } from "@/lib/interactive-target";
import { parseStoredEmbeds } from "@/lib/link-embeds/shared";
import { getPostPath } from "@/lib/seo/seo";
import { cn, formatRelativeDate } from "@/lib/utils";
import { getMediaProxyUrl } from "@/lib/utils/image-url";

interface ResponseParentCardProps {
  className?: string;
  // Null when the parent was hard-deleted: the response survives as a
  // tombstone so the thread stays readable.
  parent: PostParentData | null;
  parentPostId: string;
}

// The parent post rendered as the top node of a mini-thread: a full-width row
// whose avatar column carries a connector rail down to the reply below. Used
// when a response appears in a feed (profile Responses, home timeline), where
// there is no surrounding thread to convey the relationship.
export function ResponseParentRow({
  parent,
  parentPostId,
}: ResponseParentCardProps) {
  const router = useRouter();
  const href = parent
    ? getPostPath({
        community: parent.community,
        content: parent.content,
        id: parentPostId,
        isGust: parent.isGust,
      })
    : `/posts/${parentPostId}`;

  const handleRowClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isInteractiveTarget(e.target)) {
        return;
      }
      router.push(href);
    },
    [href, router]
  );

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" && !isInteractiveTarget(e.target)) {
        e.preventDefault();
        router.push(href);
      }
    },
    [href, router]
  );

  if (!parent) {
    return (
      <div className="flex min-h-[2.5rem] items-stretch gap-3 sm:min-h-[2.75rem]">
        <div className="flex w-9 shrink-0 flex-col items-center sm:w-10">
          <span className="bg-muted text-muted-foreground relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10">
            <ImageOff className="size-4" />
          </span>
          <span
            aria-hidden="true"
            className="bg-border -mt-1 -mb-3 w-0.5 flex-1"
          />
        </div>
        <div className="text-muted-foreground flex min-w-0 flex-1 items-center pb-1.5 text-xs italic sm:pb-2 sm:text-sm">
          This post is unavailable
        </div>
      </div>
    );
  }

  const username = parent.user?.username ?? "unknown";
  const displayName = parent.user?.displayName || username;
  const media = parent.attachments?.[0];
  const embeds = parseStoredEmbeds(parent.embeds);

  return (
    <div className="flex min-h-[2.75rem] items-stretch gap-3 sm:min-h-[3rem]">
      <div className="flex w-9 shrink-0 flex-col items-center sm:w-10">
        <Link
          aria-label={`View @${username}'s profile`}
          className="relative z-10 shrink-0"
          href={`/users/${username}`}
        >
          <UserAvatar
            className="h-9 w-9 sm:h-10 sm:w-10"
            size={36}
            user={parent.user}
          />
        </Link>
        {
          // Connector rail: continues the thread seamlessly from behind the parent avatar down to
          // behind the reply avatar below.
        }
        <span
          aria-hidden="true"
          className="bg-border -mt-1 -mb-3 w-0.5 flex-1"
        />
      </div>

      <div
        className="group/parent min-w-0 flex-1 cursor-pointer pb-1.5 sm:pb-2"
        onClick={handleRowClick}
        onKeyDown={handleRowKeyDown}
      >
        <div className="flex min-w-0 items-center gap-1.5 text-xs sm:gap-2 sm:text-sm">
          <Link
            className="text-foreground truncate font-semibold hover:underline"
            href={href}
          >
            {displayName}
          </Link>
          <UserBadge
            badge={parent.user?.badge}
            badges={parent.user?.badges}
            communityRoles={parent.user?.communityMemberships}
          />
          <Link
            className="text-muted-foreground truncate hover:underline"
            href={`/users/${username}`}
          >
            @{username}
          </Link>
          {parent.isGust ? (
            <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-1.5 text-[10px] font-semibold">
              Gust
            </span>
          ) : null}
          <span className="text-muted-foreground shrink-0">·</span>
          <Link
            className="text-muted-foreground shrink-0 hover:underline"
            href={href}
            suppressHydrationWarning
          >
            {formatRelativeDate(parent.createdAt)}
          </Link>
        </div>
        {parent.content ? (
          <div className="mt-1 line-clamp-6">
            <PostLinkedContent content={parent.content} embeds={embeds} />
          </div>
        ) : null}
        {media ? (
          <div className="border-border/60 bg-muted/20 relative mt-2.5 block aspect-[16/10] max-h-72 w-full max-w-md overflow-hidden rounded-xl border sm:max-h-80 sm:max-w-lg">
            <Image
              alt=""
              className="object-cover transition-transform duration-300 group-hover/parent:scale-[1.01]"
              fill
              sizes="(max-width: 640px) 100vw, 512px"
              src={getMediaProxyUrl({
                id: media.id,
                type: media.type as string,
              })}
              unoptimized
            />
          </div>
        ) : null}
        {embeds.length > 0 ? (
          <div className="max-w-md sm:max-w-lg">
            <PostLinkEmbeds embeds={embeds} />
          </div>
        ) : null}
        {!parent.content && !media && embeds.length === 0 ? (
          <p className="text-muted-foreground mt-1 min-w-0 text-xs italic sm:text-sm">
            Post
          </p>
        ) : null}
      </div>
    </div>
  );
}

// A compact embed of the post a response replies to, sitting above the reply.
// Tonal elevation (surface + self-colored edge) rather than an accent bar.
export default function ResponseParentCard({
  className,
  parent,
  parentPostId,
}: ResponseParentCardProps) {
  if (!parent) {
    return (
      <div
        className={cn(
          "border-border/60 bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-xl border px-3 py-2 text-xs",
          className
        )}
      >
        <ImageOff className="size-3.5 shrink-0" />
        <span>This post is unavailable</span>
      </div>
    );
  }

  const username = parent.user?.username ?? "unknown";
  const displayName = parent.user?.displayName || username;
  const media = parent.attachments?.[0];

  return (
    <Link
      className={cn(
        "group/parent border-border/60 bg-muted/30 hover:bg-muted/50 block rounded-xl border px-3 py-2.5 transition-colors",
        className
      )}
      href={getPostPath({
        content: parent.content,
        id: parentPostId,
        isGust: parent.isGust,
      })}
    >
      <div className="flex items-center gap-2 text-xs">
        <UserAvatar
          className="h-5 w-5 rounded-md"
          size={20}
          user={parent.user}
        />
        <span className="text-foreground truncate font-semibold">
          {displayName}
        </span>
        <span className="text-muted-foreground truncate">@{username}</span>
        <span className="text-muted-foreground shrink-0">·</span>
        <span
          className="text-muted-foreground shrink-0"
          suppressHydrationWarning
        >
          {formatRelativeDate(parent.createdAt)}
        </span>
      </div>

      <div className="mt-1.5 flex items-start gap-2">
        {media ? (
          <span className="border-border/60 relative block h-12 w-12 shrink-0 overflow-hidden rounded-lg border">
            <Image
              alt=""
              className="object-cover"
              fill
              sizes="48px"
              src={getMediaProxyUrl({
                id: media.id,
                type: media.type as string,
              })}
              unoptimized
            />
            {parent.isGust ? (
              <span className="absolute inset-x-0 bottom-0 bg-black/55 text-center text-[9px] font-semibold text-white">
                Gust
              </span>
            ) : null}
          </span>
        ) : null}
        {parent.content ? (
          <p className="text-muted-foreground line-clamp-2 min-w-0 text-xs leading-relaxed">
            {parent.content}
          </p>
        ) : null}
        {!parent.content && !media ? (
          <p className="text-muted-foreground min-w-0 text-xs italic">
            Media post
          </p>
        ) : null}
      </div>
    </Link>
  );
}
