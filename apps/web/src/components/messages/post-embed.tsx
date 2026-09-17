"use client";

import type { PostData } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, FileText, Play } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import UserBadge from "@/components/layouts/user/user-badge";
import ExplicitContentGate from "@/components/posts/content/explicit-content-gate";
import ModeratedNotice from "@/components/posts/content/moderated-notice";
import Linkify from "@/helpers/global/linkify";
import { isInteractiveTarget } from "@/lib/interactive-target";
import { isPopupOpen } from "@/lib/popup-tracker";
import { getPostPath } from "@/lib/seo/seo";
import { cn, formatRelativeDate } from "@/lib/utils";
import { getMediaProxyUrl, getSecureImageUrl } from "@/lib/utils/image-url";
import { withViewTransition } from "@/lib/view-transition";

interface PostEmbedProps {
  mine: boolean;
  postId: string;
}

export function PostEmbed({ mine, postId }: PostEmbedProps) {
  const { data, isError } = useQuery({
    queryFn: async () => {
      const response = await fetch(`/api/posts/${postId}`);
      if (!response.ok) {
        throw new Error("not found");
      }
      const json = (await response.json()) as { post: PostData };
      return json.post;
    },
    queryKey: ["message-post-embed", postId],
    retry: 1,
  });

  if (isError) {
    return (
      <span className="text-xs italic opacity-70">
        <FileText className="mr-1 inline h-3.5 w-3.5" />
        Post no longer available
      </span>
    );
  }

  if (!data) {
    // Loading skeleton in the message bubble while the post is fetched.
    return (
      <div
        className={cn(
          "mt-1 w-full max-w-72 animate-pulse rounded-xl border p-3",
          mine ? "border-white/40 bg-black/25" : "border-border/60 bg-muted/50"
        )}
      >
        <div className="flex items-center gap-2">
          <div className="size-6 rounded-full bg-current opacity-20" />
          <div className="h-3 w-1/3 rounded bg-current opacity-20" />
        </div>
        <div className="mt-2.5 h-3 w-3/4 rounded bg-current opacity-20" />
        <div className="mt-1.5 h-3 w-2/3 rounded bg-current opacity-20" />
      </div>
    );
  }

  return <PostEmbedCard data={data} mine={mine} />;
}

// The loaded card, split out so hooks run unconditionally above the
// loading/error early returns in PostEmbed.
function PostEmbedCard({ data, mine }: { data: PostData; mine: boolean }) {
  const href = getPostPath(data);
  // Images render directly; videos render their extracted thumbnail frame.
  const previews = (data.attachments ?? []).filter(
    (attachment) =>
      attachment.type === "IMAGE" ||
      (attachment.type === "VIDEO" && attachment.thumbnailKey)
  );
  // Gusts embed bigger: a wider card and a taller cover image. max-w-full
  // lets the card shrink to fit the bubble instead of overflowing on phones.
  const cardWidth = cn(
    "max-w-full",
    data.isGust ? "sm:max-w-80" : "sm:max-w-72"
  );
  const coverHeight = data.isGust ? "h-56" : "h-40";

  // Content: moderated posts show the notice instead of the text. Below it the
  // full-width image/video preview (gated when explicit).
  // The card navigates to the post, but its text carries inline links
  // (@mentions, #hashtags, URL badges) - so it cannot itself be an <a>
  // without nesting links, which breaks hydration. A keyboard-accessible
  // container with the feed's standard click handling instead: inner links,
  // buttons, and open popups never trigger navigation.
  const router = useRouter();

  const handleCardClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isInteractiveTarget(event.target)) {
        return;
      }
      if (isPopupOpen()) {
        return;
      }
      withViewTransition(() => router.push(href));
    },
    [href, router]
  );

  const handleCardKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      if (isInteractiveTarget(event.target)) {
        return;
      }
      if (isPopupOpen()) {
        return;
      }
      event.preventDefault();
      withViewTransition(() => router.push(href));
    },
    [href, router]
  );

  return (
    <div
      className={cn(
        "group mt-1 block w-full cursor-pointer overflow-hidden rounded-xl border text-left transition-transform hover:scale-[1.01]",
        cardWidth,
        mine ? "border-white/40 bg-black/25" : "border-border/60 bg-muted/50"
      )}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a native anchor would nest the embed's mention/hashtag/URL links (and buttons) inside it (hydration error); this container implements link semantics with keyboard handling instead.
      role="link"
      tabIndex={0}
    >
      {/* Author row */}
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <UserAvatar
          avatarUrl={
            data.user.avatarUrl ? getSecureImageUrl(data.user.avatarUrl) : null
          }
          size={24}
        />
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "flex items-center gap-1 text-xs font-semibold",
              mine ? "text-white" : "text-foreground"
            )}
          >
            <span className="truncate">
              {data.user?.displayName || data.user?.username || "Anonymous"}
            </span>
            <UserBadge
              badge={data.user?.badge}
              badges={data.user?.badges}
              communityRoles={data.user?.communityMemberships}
            />
          </span>
          <span
            className={cn(
              "block truncate text-[10px]",
              mine ? "text-white/70" : "text-muted-foreground"
            )}
          >
            @{data.user?.username || "unknown"} ·{" "}
            {formatRelativeDate(data.createdAt)}
          </span>
        </div>
      </div>

      <div className="px-3 py-2">
        {data.moderated ? (
          <ModeratedNotice className="w-full" compact kind="post" />
        ) : (
          <Linkify>
            <p
              className={cn(
                "line-clamp-3 text-xs",
                mine ? "text-white" : "text-foreground"
              )}
            >
              {data.content || "…"}
            </p>
          </Linkify>
        )}
      </div>

      {!data.moderated && previews.length > 0 ? (
        <div className="px-3 pb-2">
          <div
            className={cn(
              "group/thumb relative w-full overflow-hidden rounded-lg",
              coverHeight
            )}
          >
            {data.explicitContent ? (
              <ExplicitContentGate
                revealKey={data.id}
                className="h-full w-full"
                compact
                label="Explicit"
              >
                <Image
                  alt=""
                  className="h-full w-full object-cover"
                  fill
                  sizes="(max-width: 640px) 50vw, 320px"
                  src={getMediaProxyUrl(previews[0])}
                  unoptimized
                />
              </ExplicitContentGate>
            ) : (
              <Image
                alt=""
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                fill
                sizes="(max-width: 640px) 50vw, 320px"
                src={getMediaProxyUrl(previews[0])}
                unoptimized
              />
            )}
            {previews[0].type === "VIDEO" && !data.explicitContent ? (
              <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                <Play className="h-8 w-8 fill-white text-white" />
              </span>
            ) : null}
            {previews.length > 1 && !data.explicitContent ? (
              <span className="absolute right-1.5 bottom-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                +{previews.length - 1}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Tags + open */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-t px-3 py-1.5",
          mine ? "border-white/15" : "border-border/50"
        )}
      >
        <span
          className={cn(
            "truncate text-[10px]",
            mine ? "text-white/70" : "text-muted-foreground"
          )}
        >
          {data.tags.length > 0
            ? data.tags
                .slice(0, 3)
                .map((tag) => `#${tag.name}`)
                .join(" ")
            : "asocialmedia"}
        </span>
        <span
          className={cn(
            "flex shrink-0 items-center gap-0.5 text-[10px] font-semibold",
            mine ? "text-white/90" : "text-primary"
          )}
        >
          View {data.isGust ? "gust" : "post"}
          <ArrowUpRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}
