"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { fetchSearch } from "./spotlight-search";
import type {
  BlueskySearchResponse,
  SearchSource,
  SearchKind,
  SpotlightResponse,
} from "./spotlight-search";

export function useSpotlightSearch(
  query: string,
  source: SearchSource,
  viewer: string,
  open: boolean,
  kind: SearchKind = "all",
  networkScope = "default"
) {
  const normalized = query.trim();
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(normalized), 250);
    return () => window.clearTimeout(timer);
  }, [normalized]);
  const ready = open && normalized.length >= 2 && settled === normalized;
  const asm = useQuery({
    enabled: ready && source !== "bluesky",
    queryFn: ({ signal }) =>
      fetchSearch<SpotlightResponse>(
        `/api/search/spotlight?q=${encodeURIComponent(normalized)}&kind=${kind}`,
        signal
      ),
    queryKey: ["spotlight", "asm", viewer, normalized, kind, networkScope],
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 30_000,
  });
  const bluesky = useQuery({
    enabled: ready && source !== "asm" && kind !== "community",
    queryFn: ({ signal }) =>
      fetchSearch<BlueskySearchResponse>(
        `/api/protocols/bluesky/search?q=${encodeURIComponent(normalized)}&kind=${kind}`,
        signal
      ),
    queryKey: ["spotlight", "bluesky", viewer, normalized, kind, networkScope],
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 30_000,
  });
  return {
    asm,
    bluesky,
    waiting: normalized.length >= 2 && settled !== normalized,
  };
}
