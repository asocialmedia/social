"use client";

import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { FaGithub, FaReddit, FaXTwitter, FaYoutube } from "react-icons/fa6";

import kyInstance from "@/lib/ky";
import { sanitizeEmbedUrl } from "@/lib/link-embeds/shared";
import type { LinkEmbed } from "@/lib/link-embeds/shared";

// Inline link badges: URLs inside post content render as compact pills
// carrying the platform's logo and the resolved embed title, instead of the
// raw URL. The link itself stays the href, so nothing about the destination
// changes - only the presentation.

interface PlatformIcon {
  className: string;
  Icon: ComponentType<{ className?: string }>;
}

function platformFromUrl(url: string): PlatformIcon | null {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./u, "").toLowerCase();
  } catch {
    return null;
  }
  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtu.be"
  ) {
    return { Icon: FaYoutube, className: "text-[#ff0000]" };
  }
  if (host === "x.com" || host === "twitter.com") {
    return { Icon: FaXTwitter, className: "" };
  }
  if (host === "reddit.com" || host.endsWith(".reddit.com")) {
    return { Icon: FaReddit, className: "text-[#ff4500]" };
  }
  if (host === "github.com") {
    return { Icon: FaGithub, className: "" };
  }
  return null;
}

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return url;
  }
}

export const MAX_INLINE_LINK_PREVIEWS = 5;

export function LinkBadge({
  index = 0,
  maxPreviews = MAX_INLINE_LINK_PREVIEWS,
  title,
  url,
}: {
  index?: number;
  maxPreviews?: number;
  title?: string | null;
  url: string;
}) {
  const isPreviewAllowed = index < maxPreviews;
  const { data } = useQuery({
    enabled: isPreviewAllowed && !title && Boolean(url),
    queryFn: async () => {
      const res = await kyInstance
        .get("/api/link-preview", {
          searchParams: { url },
          timeout: 10_000,
        })
        .json<{ embed: LinkEmbed }>();
      return res.embed;
    },
    queryKey: ["link-preview", url],
    staleTime: 1000 * 60 * 30,
  });

  const platform = platformFromUrl(url);
  const label = title?.trim() || data?.title?.trim() || hostLabel(url);

  return (
    <a
      className="meta-chip inline-flex max-w-full items-center gap-1.5 align-middle text-xs"
      href={url}
      onClick={(event) => event.stopPropagation()}
      rel="nofollow ugc noopener noreferrer"
      target="_blank"
      title={label ? `${label} · ${url}` : url}
    >
      {platform ? (
        <platform.Icon className={`size-3.5 shrink-0 ${platform.className}`} />
      ) : (
        <span className="bg-muted text-muted-foreground flex size-3.5 shrink-0 items-center justify-center rounded-sm text-[8px] font-bold">
          {(hostLabel(url)[0] ?? "L").toUpperCase()}
        </span>
      )}
      <span className="max-w-56 truncate">{label}</span>
    </a>
  );
}

// Matches a stored embed for a content URL: both sides are sanitized, so a
// tracked and untracked form of the same link resolve to one badge payload.
export function findEmbedForUrl(
  url: string,
  embeds: LinkEmbed[] | undefined
): LinkEmbed | undefined {
  if (!embeds?.length) {
    return undefined;
  }
  const sanitized = sanitizeEmbedUrl(url);
  if (!sanitized) {
    return undefined;
  }
  return embeds.find((embed) => embed.url === sanitized);
}
