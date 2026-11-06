"use client";

import type { ExternalPost } from "@asm/protocols/contracts";
import { useQueries } from "@tanstack/react-query";
import { useInView } from "react-intersection-observer";

import { blueskyLinkPreviews } from "@/lib/link-embeds/bluesky-links";
import { linkPreviewQueryOptions } from "@/lib/link-embeds/preview-query";
import { parseStoredEmbeds } from "@/lib/link-embeds/shared";

export function usePostLinkPreviews(stored: unknown, external?: ExternalPost) {
  const embeds = parseStoredEmbeds(stored);
  const missing = external ? blueskyLinkPreviews(external, embeds) : [];
  const { inView, ref } = useInView({
    rootMargin: "200px 0px",
    skip: !missing.length,
    triggerOnce: true,
  });
  const queries = useQueries({
    queries: missing.map((embed) => ({
      ...linkPreviewQueryOptions(embed.url),
      enabled: inView,
    })),
  });
  return {
    embeds: [
      ...embeds,
      ...missing.map((fallback, index) => queries[index]?.data ?? fallback),
    ],
    ref,
  };
}
