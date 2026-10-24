"use client";

import { Search } from "lucide-react";

import { useSpotlight } from "@/components/search/spotlight-provider";

// Every search entry point opens the same results UI and source/type filters.
export default function SearchField({
  onAfterSearch,
}: {
  onAfterSearch?: () => void;
} = {}) {
  const { openSpotlight } = useSpotlight();
  return (
    <button
      aria-label="Search on asocialmedia"
      className="premium-input text-muted-foreground focus-visible:ring-primary flex h-10 w-full cursor-text items-center gap-2 rounded-xl px-3 text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
      onClick={() => {
        onAfterSearch?.();
        openSpotlight();
      }}
      type="button"
    >
      <Search aria-hidden className="size-4 shrink-0" />
      <span>Search on asocialmedia</span>
    </button>
  );
}
