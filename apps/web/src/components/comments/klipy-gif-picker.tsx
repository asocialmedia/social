"use client";

import { Search, X } from "lucide-react";
import Image from "next/image";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";

interface KlipyGif {
  id: number | string;
  preview: string;
  slug: string;
  title: string;
  url: string;
}

interface KlipyGifPickerProps {
  disabled?: boolean;
  onSelect: (gif: KlipyGif) => void;
}

const PLACEHOLDER = "Search KLIPY";

// GIF picker for the eddie composer. Shows trending GIFs first; typing in the
// search box switches to KLIPY search. The app key stays server-side - this
// component only talks to our own /api/gifs proxy.
export default function KlipyGifPicker({
  disabled = false,
  onSelect,
}: KlipyGifPickerProps) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<KlipyGif[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch either trending (empty query) or search results. isLoading is only
  // toggled inside async callbacks, never synchronously in an effect body.
  const runFetch = useCallback(async () => {
    const trimmed = query.trim();
    const isSearch = trimmed.length > 0;
    try {
      const data = isSearch
        ? await kyInstance
            .get("/api/gifs/search", { searchParams: { q: trimmed } })
            .json<{ gifs: KlipyGif[] }>()
        : await kyInstance
            .get("/api/gifs/trending")
            .json<{ gifs: KlipyGif[] }>();
      setGifs(data.gifs);
    } catch {
      setGifs([]);
      if (isSearch) {
        toast({
          description: "Couldn't search GIFs right now, try again?",
          title: "GIFs Unavailable",
          variant: "destructive",
        });
      }
    }
  }, [query, toast]);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    // Debounce the search; trending loads immediately when the query is empty.
    const timer = setTimeout(
      () => {
        void (async () => {
          setIsLoading(true);
          try {
            await runFetch();
          } finally {
            setIsLoading(false);
          }
        })();
      },
      query.trim() ? 350 : 0
    );
    searchTimeoutRef.current = timer;
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, runFetch]);

  let gridContent: React.ReactNode;
  if (isLoading) {
    gridContent = Array.from({ length: 8 }, (_, i) => (
      <div
        className="bg-muted/60 aspect-square w-[calc((100%-24px)/4)] shrink-0 animate-pulse rounded-lg"
        key={`gif-skeleton-${i}`}
      />
    ));
  } else if (gifs.length === 0) {
    gridContent = (
      <p className="text-muted-foreground w-full py-12 text-center text-sm">
        No GIFs found for &ldquo;{query}&rdquo;
      </p>
    );
  } else {
    gridContent = gifs.map((gif) => (
      <button
        aria-label={`Select GIF: ${gif.title || "untitled"}`}
        className="group bg-muted/40 focus-visible:ring-primary relative aspect-square w-[calc((100%-24px)/4)] shrink-0 cursor-pointer overflow-hidden rounded-lg transition-all duration-200 hover:scale-[1.03] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35),inset_0_1px_2px_rgba(255,255,255,0.3),0_0_0_1px_rgba(170,60,0,0.55),0_2px_6px_rgba(0,0,0,0.3)] focus-visible:ring-2 focus-visible:outline-none"
        disabled={disabled}
        key={String(gif.id)}
        onClick={() => onSelect(gif)}
        type="button"
      >
        <Image
          alt={gif.title || "GIF"}
          className="h-full w-full object-cover"
          fill
          sizes="(max-width: 640px) 25vw, 120px"
          src={gif.preview}
          unoptimized
        />
      </button>
    ));
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div className="reels-input flex h-9 min-w-0 flex-1 items-center gap-2 px-3">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            aria-label="Search KLIPY"
            className="placeholder:text-muted-foreground/70 w-full min-w-0 bg-transparent text-sm outline-none"
            onChange={(e) => setQuery(e.target.value)}
            placeholder={PLACEHOLDER}
            type="text"
            value={query}
          />
          {query ? (
            <button
              aria-label="Clear search"
              className="text-muted-foreground hover:text-foreground shrink-0 rounded-full p-0.5"
              onClick={() => setQuery("")}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Grid */}
      <div className="hide-native-scrollbar flex max-h-64 flex-wrap gap-2 overflow-y-auto">
        {gridContent}
      </div>
    </div>
  );
}

export type { KlipyGif };
