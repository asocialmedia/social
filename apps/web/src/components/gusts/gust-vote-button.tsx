"use client";

import type { VoteInfo } from "@asm/db";
import { ArrowBigDown, ArrowBigUp, Flame } from "lucide-react";
import { useCallback } from "react";

import { getAuraFlameClass } from "@/lib/aura";
import { cn, formatNumber } from "@/lib/utils";

import { useGustVote } from "./use-gust-vote";

interface GustVoteButtonProps {
  authorName: string;
  direction: "up" | "down";
  initialState: VoteInfo;
  interactive?: boolean;
  postId: string;
}

// Vertical vote action for the reels action rail. "up" amplifies and carries
// the bold orange aura count, "down" mutes the author. Both share the
// ["vote-info", postId] cache with the double-tap gesture so they stay in sync.
// When interactive=false (the feed's infinite-scroll mirror copy) the buttons
// render read-only so they can't fire mutations that fight the first copy.
export default function GustVoteButton({
  authorName,
  direction,
  initialState,
  interactive = true,
  postId,
}: GustVoteButtonProps) {
  const { aura, toggleVote, userVote } = useGustVote({
    authorName,
    initialState,
    postId,
  });
  const isUp = direction === "up";
  const isActive = userVote === (isUp ? 1 : -1);

  const handleVote = useCallback(() => {
    if (!interactive) {
      return;
    }
    toggleVote(isUp ? 1 : -1);
  }, [interactive, isUp, toggleVote]);

  let ariaLabel: string;
  if (isActive && isUp) {
    ariaLabel = "Remove amplification";
  } else if (isActive && !isUp) {
    ariaLabel = "Remove mute";
  } else if (isUp) {
    ariaLabel = "Amplify gust";
  } else {
    ariaLabel = "Mute author's gust";
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        aria-label={ariaLabel}
        className={cn(
          "rail-3d-btn flex h-11 w-11 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95",
          isActive && (isUp ? "rail-3d-btn-orange" : "rail-3d-btn-purple")
        )}
        onClick={handleVote}
        type="button"
      >
        {isUp ? (
          <ArrowBigUp
            className={cn("size-5 transition-colors", isActive && "fill-white")}
          />
        ) : (
          <ArrowBigDown
            className={cn("size-5 transition-colors", isActive && "fill-white")}
          />
        )}
      </button>

      {isUp ? (
        <span className="text-primary flex items-center gap-1 text-lg font-black tabular-nums drop-shadow-md">
          <Flame className={cn("size-5", getAuraFlameClass(aura))} />
          {formatNumber(aura)}
        </span>
      ) : null}
    </div>
  );
}
