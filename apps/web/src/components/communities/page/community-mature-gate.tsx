"use client";

import type { CommunityData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import errorImage from "@assets/general/error.png";
import Image from "next/image";

import CommunityAvatar from "@/components/communities/card/community-avatar";

interface CommunityMatureGateProps {
  community: CommunityData;
  onEnter: () => void;
  onLeave: () => void;
}

// The 18+ gate, rendered as a panel floating OVER the community page itself.
// The page behind stays mounted (and is blurred by the caller), so the reader
// sees exactly what they are being asked to confirm rather than an anonymous
// screen. This component only draws the scrim and the panel; positioning it and
// blurring the content underneath is the page's job.
export default function CommunityMatureGate({
  community,
  onEnter,
  onLeave,
}: CommunityMatureGateProps) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden p-4">
      {/* Scrim: the surface colour at partial opacity, not black, so the
          community behind still reads through it as a blurred backdrop.
          Deliberately NO `dark:` variant: Tailwind's `dark:` compiles to a
          `prefers-color-scheme` media query in this repo, which follows the OS
          rather than the app's `.dark` class. `--background` already follows the
          class, so one alpha is correct in both themes. */}
      <div className="absolute inset-0 bg-[hsl(var(--background))]/60" />

      {/* Panel: the app's dual-border 3D construction. rounded-3xl! is required
          because the class sets its own radius, which a plain utility cannot
          override. */}
      <div className="embed-panel-3d relative z-10 w-full max-w-md rounded-3xl! px-6 py-7 text-center">
        <div className="flex items-center justify-center gap-2.5">
          <CommunityAvatar
            accentColor={community.accentColor}
            avatarUrl={community.avatarUrl}
            className="size-9"
            name={community.name}
            slug={community.slug}
          />
          <div className="min-w-0 text-left">
            <p className="text-foreground truncate text-sm font-semibold">
              {community.name}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              a/{community.slug}
            </p>
          </div>
        </div>

        <Image
          alt=""
          className="mx-auto mt-5 size-28 object-contain sm:size-32"
          draggable={false}
          height={1199}
          src={errorImage}
          width={1312}
        />

        <h1 className="text-foreground mt-4 text-lg font-bold tracking-tight">
          a/{community.slug} is marked 18+
        </h1>
        <p className="text-muted-foreground mx-auto mt-2 max-w-xs text-sm">
          This community may contain mature content. You must be over 18 to view
          and contribute.
        </p>

        <div className="mt-6 flex flex-col-reverse items-stretch justify-center gap-2 sm:flex-row sm:items-center">
          <Button
            className="btn-3d-gray h-10 rounded-full px-5 text-sm!"
            onClick={onLeave}
            type="button"
            variant="ghost"
          >
            Go back
          </Button>
          <Button
            className="h-10 px-6 text-sm!"
            onClick={onEnter}
            type="button"
            variant="premium"
          >
            I am 18 or older
          </Button>
        </div>
      </div>
    </div>
  );
}
