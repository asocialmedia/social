"use client";

import { Button } from "@asm/ui/shadui/button";
import { Search } from "lucide-react";

import { useSpotlight } from "@/components/search/spotlight-provider";

export function ExploreGuestSearch() {
  const { openSpotlight } = useSpotlight();
  return (
    <div className="px-4 pt-3 pb-1" data-testid="explore-guest-search">
      <Button
        aria-label="Search people, posts, and communities"
        className="premium-input text-muted-foreground h-12 w-full justify-start rounded-xl! px-3 font-normal"
        onClick={() => openSpotlight()}
        type="button"
        variant="ghost"
      >
        <Search className="size-4.5 shrink-0" />
        <span className="truncate">Search people, posts, and communities</span>
      </Button>
    </div>
  );
}
