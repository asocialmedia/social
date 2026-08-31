"use client";

import { useQueries } from "@tanstack/react-query";
import kyInstance from "ky";
import { Loader2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { EmbedSiteBadge } from "@/components/posts/embed-utils";
import useDebounce from "@/hooks/use-debounce";
import { extractPostUrls, MAX_POST_EMBEDS } from "@/lib/link-embeds/shared";
import type { LinkEmbed } from "@/lib/link-embeds/shared";

// How long typing must settle before a link preview fires. The resolver
// caches server-side, so the debounce only spares the pipeline redundant
// lookups for URLs the author is still writing.
const LINK_PREVIEW_DEBOUNCE_MS = 700;

interface LinkEmbedComposerProps {
  // The composer's current plain text; URLs are re-extracted on change.
  content: string;
  dismissedUrls: ReadonlySet<string>;
  onDismiss: (url: string) => void;
}

interface LinkPreviewResponse {
  embed: LinkEmbed;
}

// Live link previews inside the composer: as the author types a link, the
// server-resolved embed (title, thumbnail, or a YouTube card) appears below
// with a dismiss button - dismissed links are excluded from the published
// post's stored embeds. Resolution runs server-side behind the SSRF guard;
// this component only renders the API's validated payload.

export default function LinkEmbedComposer({
  content,
  dismissedUrls,
  onDismiss,
}: LinkEmbedComposerProps) {
  const debouncedContent = useDebounce(content, LINK_PREVIEW_DEBOUNCE_MS);
  const urls = extractPostUrls(debouncedContent).filter(
    (url) => !dismissedUrls.has(url)
  );

  const queries = useQueries({
    queries: urls.map((url) => ({
      enabled: true,
      queryFn: async (): Promise<LinkEmbed | null> => {
        const response = await kyInstance
          .get("/api/link-preview", { searchParams: { url }, timeout: 15_000 })
          .json<LinkPreviewResponse>();
        return response.embed;
      },
      queryKey: ["link-preview", url],
      // The server caches resolved embeds; failures retry a couple of
      // times while the author keeps typing, then stay quiet.
      retry: 1,
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });

  const visible = urls
    .map((url, index) => ({
      embed: queries[index]?.data ?? null,
      isLoading: Boolean(queries[index]?.isPending),
      url,
    }))
    .slice(0, MAX_POST_EMBEDS);

  if (visible.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {visible.map(({ embed, isLoading, url }) => (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            initial={{ opacity: 0, y: 8 }}
            key={url}
            transition={{ duration: 0.15 }}
          >
            <div className="embed-panel-3d overflow-hidden p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <EmbedSiteBadge
                    siteName={embed?.siteName ?? null}
                    url={embed?.url ?? url}
                  />
                  <span className="text-muted-foreground truncate text-xs">
                    {embed?.siteName ??
                      (isLoading ? "Resolving link…" : "Link")}
                  </span>
                  {isLoading ? (
                    <Loader2 className="text-muted-foreground size-3 animate-spin" />
                  ) : null}
                </div>
                <button
                  aria-label={`Dismiss preview for ${url}`}
                  className="pill-3d-hover text-muted-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  onClick={() => onDismiss(url)}
                  type="button"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              {embed ? (
                <p className="text-foreground mt-1.5 line-clamp-2 text-sm font-medium">
                  {embed.title}
                </p>
              ) : null}
              {embed?.description ? (
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                  {embed.description}
                </p>
              ) : null}
              {embed?.type === "youtube" && embed.videoId ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  YouTube player will be attached to this post
                </p>
              ) : null}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
