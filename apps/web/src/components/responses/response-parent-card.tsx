import type { PostParentData } from "@asm/db";
import { ImageOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import UserAvatar from "@/components/layouts/user-avatar";
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
