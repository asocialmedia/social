"use client";

import type { GustFollowingAvatar } from "@asm/ui/lib/gust-header";
import { discoveryFeedPress } from "@asm/ui/lib/home-feed-controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { ChevronDown, Clock3, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";

import UserAvatar from "@/components/layouts/user/user-avatar";
import { useFeedReselect } from "@/hooks/feed/use-feed-reselect";
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
  const indicatorId = useId();
  const reducedMotion = useReducedMotion();
  const indicatorTransition = {
    duration: reducedMotion ? 0 : 0.22,
    ease: "easeInOut",
  } as const;
  const [discovery, setDiscovery] = useState<"latest" | "personalized">(
    active === "latest" ? "latest" : "personalized"
  );
  const selected = active === "following" ? discovery : active;
  if (selected !== discovery) {
    setDiscovery(selected);
  }
  const [menuOpen, setMenuOpen] = useState(false);
  const reselectDiscovery = useFeedReselect(active === selected, () =>
    onChange(selected)
  );
  const alternative = selected === "latest" ? "personalized" : "latest";
  const AlternativeIcon = alternative === "latest" ? Clock3 : Sparkles;
  const text = selected === "latest" ? "Latest" : "For you";
  const control =
    "relative flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold [text-shadow:0_1px_4px_rgba(0,0,0,0.8)]";
  const underline = (
    <motion.span
      aria-hidden
      className="absolute inset-x-0 bottom-0.5 mx-auto h-0.5 w-6 rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500]"
      initial={false}
      layoutId={indicatorId}
      transition={indicatorTransition}
    />
  );
  return (
    <div className="flex items-center gap-1 font-sans" data-gust-feed-controls>
      <DropdownMenu
        open={menuOpen && active === selected}
        onOpenChange={(open) => {
          const action = discoveryFeedPress(active, selected);
          if (open && action.type === "navigate") {
            setMenuOpen(false);
            onChange(action.feed);
          } else {
            setMenuOpen(open);
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            {...reselectDiscovery}
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
        <DropdownMenuContent align="start" className="min-w-32 p-1.5 font-sans">
          <DropdownMenuItem
            className="pill-3d-hover gap-3 rounded-md px-2 py-2"
            onSelect={() => {
              setDiscovery(alternative);
              setMenuOpen(false);
              onChange(alternative);
            }}
          >
            <AlternativeIcon
              className="size-4"
              fill={alternative === "personalized" ? "currentColor" : "none"}
            />
            {alternative === "latest" ? "Latest" : "For you"}
          </DropdownMenuItem>
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
        <span className="relative flex min-h-11 items-center">
          Following
          {active === "following" ? (
            <motion.span
              aria-hidden
              className="absolute inset-x-0 bottom-0.5 mx-auto h-0.5 w-12 rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500]"
              initial={false}
              layoutId={indicatorId}
              transition={indicatorTransition}
            />
          ) : null}
        </span>
        {avatars.length ? (
          <span
            className="ml-0.5 flex -space-x-2.5 max-[360px]:[&>span:nth-child(n+3)]:hidden"
            aria-hidden
          >
            {avatars.map((person, index) => (
              <span
                key={person.id}
                className="rounded-lg ring-1 ring-black/70"
                style={{ zIndex: avatars.length - index }}
              >
                <UserAvatar
                  avatarUrl={person.avatarUrl}
                  className="rounded-lg!"
                  seed={person.id}
                  size={24}
                />
              </span>
            ))}
          </span>
        ) : null}
      </button>
    </div>
  );
}
