// React binding for the live link preview resolver.
//
// A body with links must not block on them: the text renders first and the
// embeds fill in when they arrive, so a slow or dead preview endpoint costs a
// reader nothing. The resolver is memoized per API base, so scrolling a list
// of eddies does not build a separate cache per row.

import { useEffect, useMemo, useState } from "react";

import type { LinkEmbed } from "@/features/feed/lib/link-embeds";
import {
  createLinkPreviewResolver,
  extractPostUrls,
} from "@/features/feed/lib/link-preview-resolver";
import { getApiBaseUrl } from "@/lib/api-env";
import { logInfo, logWarn } from "@/lib/telemetry";

const log = {
  info: logInfo,
  warn: logWarn,
};

let sharedResolver: ReturnType<typeof createLinkPreviewResolver> | null = null;
let sharedApiBase = "";

function resolverForApiBase(): ReturnType<typeof createLinkPreviewResolver> {
  const apiBase = getApiBaseUrl();
  if (!sharedResolver || sharedApiBase !== apiBase) {
    sharedResolver = createLinkPreviewResolver({ apiBase, log });
    sharedApiBase = apiBase;
  }
  return sharedResolver;
}

/**
 * Resolves the links in `content` to embeds. `embeds` stays empty until they
 * arrive and stays empty when the body has no links, so a caller can render
 * unconditionally. `loading` is only true when there was genuinely something
 * to wait for, so a linkless body never flashes a spinner.
 */
export function useLinkPreviews(content: string | null | undefined): {
  embeds: LinkEmbed[];
  loading: boolean;
} {
  const resolver = useMemo(() => resolverForApiBase(), []);
  const urlCount = extractPostUrls(content).length;
  const [embeds, setEmbeds] = useState<LinkEmbed[]>([]);

  useEffect(() => {
    if (urlCount === 0) {
      return;
    }
    let active = true;
    const run = async () => {
      const resolved = await resolver.loadAll(content);
      if (active) {
        setEmbeds(resolved);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [content, resolver, urlCount]);

  // A body with no links has nothing to show, and the previous body's embeds
  // must not linger under a new one, so the empty case is derived here rather
  // than written back from an effect.
  const visible = urlCount === 0 ? [] : embeds;
  return { embeds: visible, loading: urlCount > 0 && visible.length === 0 };
}
