"use client";

import { getCommunityTopic } from "@asm/db/communities";
import { Flame, LayoutGrid, Users } from "lucide-react";
import Image from "next/image";

import CommunityAvatar from "@/components/communities/community-avatar";
import { communityAccentStyle } from "@/lib/communities/accent";
import { formatNumber } from "@/lib/utils";

interface CreateCommunityPreviewProps {
  accentColor: string;
  avatarPreview: string | null;
  bannerPreview: string | null;
  description: string;
  mature: boolean;
  name: string;
  slug: string;
  topics: string[];
}

// A live, presentational preview of the community as the discovery card will
// present it. Mirrors CommunityCard's composition - a banner header that
// feathers into the surface, the mark overlapping it, identity, description and
// the stat row - without being a link or needing a persisted row, so the
// creator sees the real shape before publishing.
export default function CreateCommunityPreview({
  accentColor,
  avatarPreview,
  bannerPreview,
  description,
  mature,
  name,
  slug,
  topics,
}: CreateCommunityPreviewProps) {
  const displayName = name.trim() || "Your community";
  const displaySlug = slug.trim() || "address";

  return (
    <div className="flex flex-col gap-3">
      <div
        className="sidebar-subcard flex flex-col overflow-hidden rounded-2xl"
        style={communityAccentStyle(accentColor)}
      >
        {/* Banner header: the uploaded image when there is one, otherwise a
            tonal wash drawn from the accent, exactly as the card falls back. */}
        <div className="relative h-24 w-full shrink-0 overflow-hidden">
          {bannerPreview ? (
            <Image
              alt=""
              className="object-cover"
              fill
              sizes="320px"
              src={bannerPreview}
              unoptimized
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(135deg, color-mix(in srgb, var(--community-accent) 30%, hsl(var(--muted))), hsl(var(--muted)))",
              }}
            />
          )}
          <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-b from-transparent to-[hsl(var(--background-alt))]" />
          {mature ? (
            <span className="bg-background/85 text-foreground absolute top-2.5 right-2.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums backdrop-blur-sm">
              18+
            </span>
          ) : null}
        </div>

        <div className="flex flex-col px-3.5 pb-3.5">
          {/* `relative z-10` is required, not cosmetic: the banner above is
              position:relative, so without lifting the mark it paints over this
              static block and slices the avatar across its middle. */}
          <div className="relative z-10 -mt-8">
            <CommunityAvatar
              accentColor={accentColor}
              avatarUrl={avatarPreview}
              className="size-14"
              name={displayName}
              slug={displaySlug}
            />
          </div>

          <div className="mt-2.5 min-w-0">
            <p className="text-foreground truncate font-bold tracking-tight">
              {displayName}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              a/{displaySlug}
            </p>
          </div>

          <p className="text-muted-foreground mt-2 line-clamp-3 min-h-10 text-sm">
            {description.trim() ||
              "Describe what this community is about so people know what to expect."}
          </p>

          {topics.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1">
              {topics.map((key) => (
                <span
                  className="bg-muted/60 text-muted-foreground rounded-md px-1.5 py-0.5 text-[11px]"
                  key={key}
                >
                  {getCommunityTopic(key)?.label ?? key}
                </span>
              ))}
            </div>
          ) : null}

          {/* The card's stat row, with the numbers a new community actually
              starts from: one member (the creator) and no posts yet. */}
          <div className="text-muted-foreground border-border/60 mt-3 flex items-center gap-x-4 border-t pt-2.5 text-xs">
            <span className="flex items-center gap-1.5" title="Community aura">
              <Flame aria-hidden="true" className="size-3.5 text-orange-500" />
              <span className="text-foreground font-semibold tabular-nums">
                {formatNumber(0)}
              </span>
            </span>
            <span className="flex items-center gap-1.5" title="Members">
              <Users
                aria-hidden="true"
                className="text-primary size-3.5"
                fill="currentColor"
              />
              <span className="text-foreground font-semibold tabular-nums">
                {formatNumber(1)}
              </span>
            </span>
            <span className="flex items-center gap-1.5" title="Posts">
              <LayoutGrid
                aria-hidden="true"
                className="text-primary size-3.5"
                fill="currentColor"
              />
              <span className="text-foreground font-semibold tabular-nums">
                {formatNumber(0)}
              </span>
            </span>
          </div>
        </div>
      </div>

      <p className="text-muted-foreground text-[11px]">
        1 weekly visitor · 1 weekly contributor
      </p>
    </div>
  );
}
