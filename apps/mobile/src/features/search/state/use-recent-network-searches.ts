import { File, Paths } from "expo-file-system";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { nativeNetworkPath } from "@/features/network/lib/network-paths";

import { recentLabel, rememberRecent } from "../lib/recent-searches";
import {
  readSearchCandidates,
  rememberCandidates,
} from "../lib/search-candidates";
import type { SearchCandidate, SearchTarget } from "../lib/search-candidates";
import type { SearchKind, SearchSource } from "./use-network-search";

const normalizeRecentLabel = (label: string) => label.slice(0, 280);

const recentSchema = z.object({
  at: z.number(),
  avatarUrl: z.string().max(2048).nullable().optional(),
  explicit: z.boolean().optional(),
  href: z.string().max(2048).optional(),
  id: z.string().max(1024).optional(),
  kind: z.enum(["all", "user", "post", "community"]).default("all"),
  label: z.string().transform(normalizeRecentLabel).optional(),
  query: z.string().max(80),
  source: z.enum(["all", "asm", "bluesky"]),
  subtitle: z.string().max(160).optional(),
  type: z.enum(["user", "post", "community"]).optional(),
});
export type RecentNetworkSearch = z.infer<typeof recentSchema>;
export interface RecentSearchTarget {
  avatarUrl?: string | null;
  explicit?: boolean;
  href: string;
  id?: string;
  label: string;
  subtitle?: string;
  type?: "user" | "post" | "community";
}
const values = new Map<string, RecentNetworkSearch[]>();
const candidateValues = new Map<string, SearchCandidate[]>();

const historyFile = (viewer: string) =>
  new File(
    Paths.document,
    `asm-network-search-${encodeURIComponent(viewer)}.json`
  );
const candidateFile = (viewer: string) =>
  new File(
    Paths.document,
    `asm-network-search-candidates-${encodeURIComponent(viewer)}.json`
  );

async function readCandidates(viewer: string): Promise<SearchCandidate[]> {
  try {
    return readSearchCandidates(JSON.parse(await candidateFile(viewer).text()));
  } catch {
    return [];
  }
}

export function useRecentNetworkSearches(viewer: string) {
  const [data, setData] = useState<{
    viewer: string;
    items: RecentNetworkSearch[];
  }>({ items: values.get(viewer) ?? [], viewer });
  const [candidates, setCandidates] = useState<{
    viewer: string;
    items: SearchCandidate[];
  }>({ items: candidateValues.get(viewer) ?? [], viewer });
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        // Web's readRecentSearches: one bad entry is dropped on its own
        // instead of discarding the whole list.
        const raw: unknown = JSON.parse(await historyFile(viewer).text());
        const saved = (Array.isArray(raw) ? raw : [])
          .flatMap((entry) => {
            const parsed = recentSchema.safeParse(entry);
            return parsed.success ? [parsed.data] : [];
          })
          .slice(0, 10)
          .filter((item) => !item.href || nativeNetworkPath(item.href))
          .map((item) =>
            item.explicit && item.label
              ? { ...item, label: recentLabel(item.label, true) }
              : item
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
      const storedCandidates =
        candidateValues.get(viewer) ?? (await readCandidates(viewer));
      candidateValues.set(viewer, storedCandidates);
      if (active) {
        setCandidates({ items: storedCandidates, viewer });
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
      await historyFile(viewer).write(JSON.stringify(items));
    } catch {
      // Recent searches are best effort; navigation remains available.
    }
  };
  const saveCandidates = useCallback(
    async (items: SearchCandidate[]) => {
      candidateValues.set(viewer, items);
      setCandidates({ items, viewer });
      try {
        await candidateFile(viewer).write(JSON.stringify(items));
      } catch {
        // Suggestions are best effort; search keeps working without them.
      }
    },
    [viewer]
  );
  // Remembers the results a query surfaced so guests get them back as
  // suggestions, matching web's useRecentSearches().collect.
  const collect = useCallback(
    (targets: SearchTarget[], query: string) => {
      const current = candidateValues.get(viewer) ?? [];
      const next = rememberCandidates(current, targets, query);
      if (next !== current) {
        void saveCandidates(next);
      }
    },
    [saveCandidates, viewer]
  );
  return {
    candidates: candidates.viewer === viewer ? candidates.items : [],
    clear: async () => {
      await save([]);
      if ((candidateValues.get(viewer) ?? []).length > 0) {
        await saveCandidates([]);
      }
    },
    collect,
    items: data.viewer === viewer ? data.items : [],
    remember: (
      query: string,
      source: SearchSource,
      target?: RecentSearchTarget,
      kind: SearchKind = "all"
    ) => {
      if (target && !nativeNetworkPath(target.href)) {
        return;
      }
      const item = {
        at: Date.now(),
        kind,
        query: query.trim().slice(0, 80),
        source,
        ...target,
        label: target ? recentLabel(target.label, target.explicit) : undefined,
        subtitle: target?.subtitle?.slice(0, 160),
      };
      if (!item.query) {
        return;
      }
      void save(rememberRecent(values.get(viewer) ?? [], item));
    },
    remove: (at: number) =>
      save((values.get(viewer) ?? []).filter((item) => item.at !== at)),
  };
}
