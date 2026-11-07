// Missing Bluesky preview backfill, ported from web's
// posts/embeds/use-post-link-previews.ts. Native posts carry stored embeds,
// but Bluesky posts often arrive with none: this hook adds the single missing
// card (Bluesky's single-card layout) and resolves it through the shared
// cached link-preview resolver, so the card fills in without blocking the
// body. The unresolved fallback (title + site) renders immediately.
//
// Web gates the fetch on useInView (200px root margin, trigger once). Feed
// cards have no shared in-view bus on native, so the fetch runs on mount:
// FlashList only mounts rows near the viewport and the resolver memoizes per
// URL, which bounds the cost the same way in practice.
import { useEffect, useMemo, useState } from "react";

import type { LinkEmbed, PreviewSegment } from "./link-embeds";
import { blueskyLinkFallbacks, parseStoredEmbeds } from "./link-embeds";
import { sanitizeEmbedUrl } from "./link-preview-resolver";
import { resolverForApiBase } from "./use-link-previews";

export interface BackfillExternal {
  segments?: readonly PreviewSegment[] | null;
  text?: string | null;
}

export function usePostLinkPreviews(
  stored: unknown,
  external?: BackfillExternal | null
): { embeds: LinkEmbed[]; loading: boolean } {
  const parsed = useMemo(() => parseStoredEmbeds(stored), [stored]);
  const fallback = useMemo(() => {
    if (!external) {
      return null;
    }
    const [candidate] = blueskyLinkFallbacks(
      external.segments ?? [],
      external.text ?? null,
      parsed
    );
    if (!candidate) {
      return null;
    }
    // The resolver only answers for sanitized URLs; an unsanitizable
    // candidate keeps its title/site fallback with no fetch.
    const sanitized = sanitizeEmbedUrl(candidate.url);
    if (!sanitized) {
      return candidate;
    }
    return { ...candidate, url: sanitized };
  }, [external, parsed]);
  const [resolved, setResolved] = useState<{
    embed: LinkEmbed;
    url: string;
  } | null>(null);

  useEffect(() => {
    if (!fallback) {
      return;
    }
    let active = true;
    const { url } = fallback;
    const run = async () => {
      const embed = await resolverForApiBase().load(url);
      if (active && embed) {
        setResolved({ embed, url });
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [fallback]);

  const embeds = useMemo(() => {
    if (!fallback) {
      return parsed;
    }
    const current =
      resolved && resolved.url === fallback.url ? resolved.embed : fallback;
    return [...parsed, current];
  }, [fallback, parsed, resolved]);
  return {
    embeds,
    loading: Boolean(fallback && (!resolved || resolved.url !== fallback.url)),
  };
}
