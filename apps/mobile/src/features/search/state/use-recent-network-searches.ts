import { File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";
import { z } from "zod";

import { nativeNetworkPath } from "@/features/network/lib/network-paths";

import type { SearchKind, SearchSource } from "./use-network-search";

const normalizeRecentLabel = (label: string) => label.slice(0, 280);

const recentSchema = z.object({
  at: z.number(),
  explicit: z.boolean().optional(),
  href: z.string().max(2048).optional(),
  kind: z.enum(["all", "user", "post", "community"]).default("all"),
  label: z.string().transform(normalizeRecentLabel).optional(),
  query: z.string().max(80),
  source: z.enum(["all", "asm", "bluesky"]),
});
export type RecentNetworkSearch = z.infer<typeof recentSchema>;
const values = new Map<string, RecentNetworkSearch[]>();

export function useRecentNetworkSearches(viewer: string) {
  const [data, setData] = useState<{
    viewer: string;
    items: RecentNetworkSearch[];
  }>({ items: values.get(viewer) ?? [], viewer });
  useEffect(() => {
    let active = true;
    const file = new File(
      Paths.document,
      `asm-network-search-${encodeURIComponent(viewer)}.json`
    );
    const read = async () => {
      try {
        const saved = z
          .array(recentSchema)
          .max(10)
          .parse(JSON.parse(await file.text()))
          .filter(
            (item) =>
              !item.explicit && (!item.href || nativeNetworkPath(item.href))
          );
        const current = values.get(viewer) ?? saved;
        values.set(viewer, current);
        if (active) {
          setData({ items: current, viewer });
        }
      } catch {
        if (active) {
          setData({ items: values.get(viewer) ?? [], viewer });
        }
      }
    };
    void read();
    return () => {
      active = false;
    };
  }, [viewer]);
  const save = async (items: RecentNetworkSearch[]) => {
    values.set(viewer, items);
    setData({ items, viewer });
    try {
      const file = new File(
        Paths.document,
        `asm-network-search-${encodeURIComponent(viewer)}.json`
      );
      await file.write(JSON.stringify(items));
    } catch {
      // Recent searches are best effort; navigation remains available.
    }
  };
  return {
    clear: () => save([]),
    items: data.viewer === viewer ? data.items : [],
    remember: (
      query: string,
      source: SearchSource,
      target?: { href: string; label: string; explicit?: boolean },
      kind: SearchKind = "all"
    ) => {
      if (target?.explicit || (target && !nativeNetworkPath(target.href))) {
        return;
      }
      const item = {
        at: Date.now(),
        kind,
        query: query.trim().slice(0, 80),
        source,
        ...target,
        label: target ? normalizeRecentLabel(target.label) : undefined,
      };
      if (!item.query) {
        return;
      }
      void save(
        [
          item,
          ...(values.get(viewer) ?? []).filter((previous) =>
            target
              ? previous.href !== target.href
              : previous.query !== item.query || previous.source !== source
          ),
        ].slice(0, 10)
      );
    },
    remove: (at: number) =>
      save((values.get(viewer) ?? []).filter((item) => item.at !== at)),
  };
}
