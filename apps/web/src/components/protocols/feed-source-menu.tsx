"use client";

import { feedSourceLabels } from "@asm/protocols/discovery";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { SlidersHorizontal } from "lucide-react";

import { useFeedSourceStore } from "@/store/feed-source-store";

export function FeedSourceMenu({ following }: { following: boolean }) {
  const source = useFeedSourceStore((state) => state.source);
  const setSource = useFeedSourceStore((state) => state.setSource);
  const language = useFeedSourceStore((state) => state.language);
  const setLanguage = useFeedSourceStore((state) => state.setLanguage);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Feed sources: ${following ? "ASM" : feedSourceLabels[source]}`}
          className="pill-3d-hover text-muted-foreground mx-1 flex size-9 shrink-0 items-center justify-center rounded-full"
          type="button"
        >
          <SlidersHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel>Feed sources</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={following ? "asm" : source}
          onValueChange={(value) => {
            if (value === "all" || value === "asm" || value === "bluesky") {
              setSource(value);
            }
          }}
        >
          {(["all", "asm", "bluesky"] as const).map((value) => (
            <DropdownMenuRadioItem
              disabled={following}
              key={value}
              value={value}
            >
              {feedSourceLabels[value]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Content language</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={language}
          onValueChange={(value) => {
            if (value === "auto" || value === "en" || value === "all") {
              setLanguage(value);
            }
          }}
        >
          <DropdownMenuRadioItem value="auto">
            Use device language
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="all">
            All languages
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <p className="text-muted-foreground max-w-56 px-2 py-1.5 text-xs">
          {following
            ? "Following shows the ASM people you follow."
            : "Public Bluesky posts, matched to your language and region."}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
