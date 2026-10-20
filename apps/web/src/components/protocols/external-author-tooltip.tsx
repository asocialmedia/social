"use client";

import type { ExternalAuthor } from "@asm/protocols/contracts";
import { externalAuthorSchema } from "@asm/protocols/discovery";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import { PostInlineContent } from "@/components/posts/content/post-inline-content";
import { useMediaQuery } from "@/hooks/use-media-query";
import { blueskyProfilePath } from "@/lib/protocols/paths";
import { readProtocolResource } from "@/lib/protocols/read-resource";
import { formatNumber } from "@/lib/utils";
import { getSecureImageUrl } from "@/lib/utils/image-url";

import { BlueskyIcon } from "./bluesky-icon";
import { ExternalFollowButton } from "./external-follow-button";

export function ExternalAuthorTooltip({
  author,
  children,
}: {
  author: ExternalAuthor;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const mobile = useMediaQuery("(max-width: 767px)");
  const profile = useQuery({
    enabled: open && !mobile,
    queryFn: async ({ signal }) =>
      externalAuthorSchema.parse(
        await readProtocolResource(
          `/api/protocols/bluesky/profile?${new URLSearchParams({ actor: author.id })}`,
          signal
        )
      ),
    queryKey: ["bluesky-author-preview", author.id],
    retry: false,
    staleTime: 60_000,
  });
  const person = profile.data ?? author;
  const href = blueskyProfilePath(person.id);
  if (mobile) {
    return children;
  }
  return (
    <TooltipProvider delayDuration={350}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          className="w-80 overflow-hidden p-0"
          sideOffset={6}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="relative h-20 bg-[#0085ff]/20 bg-cover bg-center"
            style={
              person.bannerUrl
                ? {
                    backgroundImage: `url(${getSecureImageUrl(person.bannerUrl)})`,
                  }
                : undefined
            }
          >
            <div className="absolute inset-0 bg-linear-to-t from-[hsl(var(--background-alt))] to-transparent" />
          </div>
          <div className="relative space-y-3 px-3 pb-3">
            <div className="-mt-8 flex items-end justify-between gap-3">
              <Link
                href={href}
                className="rounded-xl bg-[hsl(var(--background-alt))] p-1"
              >
                <UserAvatar avatarUrl={person.avatarUrl} size={56} />
              </Link>
              <ExternalFollowButton did={person.id} />
            </div>
            <Link href={href} className="block min-w-0">
              <span className="flex items-center gap-2 text-base font-semibold">
                <span className="truncate">
                  {person.displayName || person.handle}
                </span>
                <BlueskyIcon tooltip={false} />
              </span>
              <span className="text-muted-foreground block truncate text-sm">
                @{person.handle}
              </span>
            </Link>
            {person.description ? (
              <PostInlineContent
                className="line-clamp-4 text-sm whitespace-pre-line"
                content={person.description}
                linkBadge="chip"
              />
            ) : null}
            <div className="text-muted-foreground flex gap-4 text-xs">
              <span>
                <strong className="text-foreground">
                  {person.upstreamCounts.followers === undefined
                    ? "—"
                    : formatNumber(person.upstreamCounts.followers)}
                </strong>{" "}
                Followers
              </span>
              <span>
                <strong className="text-foreground">
                  {person.upstreamCounts.following === undefined
                    ? "—"
                    : formatNumber(person.upstreamCounts.following)}
                </strong>{" "}
                Following
              </span>
              <span>
                <strong className="text-foreground">
                  {person.upstreamCounts.posts === undefined
                    ? "—"
                    : formatNumber(person.upstreamCounts.posts)}
                </strong>{" "}
                Posts
              </span>
            </div>
            {profile.isError ? (
              <p className="text-muted-foreground text-xs">
                Profile details are temporarily unavailable.
              </p>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
