"use client";

import type { GustFollowingAvatar } from "@asm/ui/lib/gust-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import { cn } from "@/lib/utils";

export type GustFeed = "following" | "latest" | "personalized";

export function GustFeedControls({
  active,
  avatars,
  onChange,
}: {
  active: GustFeed;
  avatars: readonly GustFollowingAvatar[];
  onChange: (feed: GustFeed) => void;
}) {
  const [discovery, setDiscovery] = useState<"latest" | "personalized">(
    active === "latest" ? "latest" : "personalized"
  );
  const selected = active === "following" ? discovery : active;
  const text = selected === "latest" ? "Latest" : "For you";
  const control =
    "relative flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold [text-shadow:0_1px_4px_rgba(0,0,0,0.8)]";
  const underline = (
    <span
      aria-hidden
      className="absolute bottom-0.5 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500]"
    />
  );
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`${text}, choose Gusts feed`}
            className={cn(
              control,
              active === "following" ? "text-white/70" : "text-white"
            )}
            type="button"
          >
            {text}
            <ChevronDown className="size-3.5" />
            {active === "following" ? null : underline}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={selected}
            onValueChange={(value) => {
              if (value === "latest" || value === "personalized") {
                setDiscovery(value);
                onChange(value);
              }
            }}
          >
            <DropdownMenuRadioItem value="personalized">
              For you
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="latest">Latest</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        aria-label="Following Gusts"
        aria-pressed={active === "following"}
        className={cn(
          control,
          active === "following" ? "text-white" : "text-white/70"
        )}
        onClick={() => onChange("following")}
        type="button"
      >
        Following
        {avatars.length ? (
          <span className="ml-0.5 flex -space-x-2.5" aria-hidden>
            {avatars.map((person, index) => (
              <span
                key={person.id}
                className="rounded-full ring-1 ring-black/70"
                style={{ zIndex: avatars.length - index }}
              >
                <UserAvatar
                  avatarUrl={person.avatarUrl}
                  className="rounded-full!"
                  seed={person.id}
                  size={24}
                />
              </span>
            ))}
          </span>
        ) : null}
        {active === "following" ? underline : null}
      </button>
    </div>
  );
}
