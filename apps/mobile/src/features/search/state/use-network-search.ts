// oxlint-disable react/set-state-in-effect -- This effect synchronizes debounced requests and externally cached results with the active search key.
import {
  blueskyMediaIsExplicit,
  networkPostAllowed,
  externalNetworkPostAllowed,
  externalAuthorSchema,
  externalPostSchema,
} from "@asm/protocols/discovery";
import { useEffect, useState, useMemo } from "react";
import { z } from "zod";

import { networkRequest } from "@/features/network/lib/network-api";
import { useNetworkSettings } from "@/features/network/state/use-network-settings";

import { parseSpotlightResponse } from "../lib/search-api";
import type { SpotlightResponse } from "../lib/search-api";

export type SearchSource = "all" | "asm" | "bluesky";
export type SearchKind = "all" | "user" | "post" | "community";
const remoteSchema = z.object({
  posts: z.array(externalPostSchema),
  profiles: z.array(externalAuthorSchema),
  unavailable: z.array(z.enum(["profiles", "posts"])).default([]),
});
const EMPTY_ASM: SpotlightResponse = { communities: [], posts: [], users: [] };
const EMPTY_REMOTE: z.infer<typeof remoteSchema> = {
  posts: [],
  profiles: [],
  unavailable: [],
};
interface SearchState {
  key: string;
  asm: SpotlightResponse;
  bluesky: z.infer<typeof remoteSchema>;
  asmLoading: boolean;
  remoteLoading: boolean;
  asmError: string | null;
  remoteError: string | null;
}
const cache = new Map<string, { value: SearchState; updatedAt: number }>();

export function useNetworkSearch(
  query: string,
  source: SearchSource,
  kind: SearchKind,
  open: boolean
) {
  const network = useNetworkSettings();
  const trimmed = query.trim();
  const key = `${network.viewer}:${network.scope}:${source}:${kind}:${trimmed}`;
  const [attempt, setAttempt] = useState(0);
  const empty = useMemo<SearchState>(
    () => ({
      asm: EMPTY_ASM,
      asmError: null,
      asmLoading: false,
      bluesky: EMPTY_REMOTE,
      key,
      remoteError: null,
      remoteLoading: false,
    }),
    [key]
  );
  const [state, setState] = useState<SearchState>(empty);
  useEffect(() => {
    const controller = new AbortController();
    if (!open || trimmed.length < 2 || !network.ready) {
      return () => controller.abort();
    }
    const saved = cache.get(key);
    if (attempt === 0 && saved && Date.now() - saved.updatedAt < 30_000) {
      setState(saved.value);
      return () => controller.abort();
    }
    const asm = source !== "bluesky";
    const remote = source !== "asm" && kind !== "community";
    let next: SearchState = {
      ...empty,
      asmLoading: asm,
      remoteLoading: remote,
    };
    setState(next);
    const patch = (value: Partial<SearchState>) => {
      if (controller.signal.aborted) {
        return;
      }
      next = { ...next, ...value };
      setState(next);
      if (!next.asmLoading && !next.remoteLoading) {
        cache.set(key, { updatedAt: Date.now(), value: next });
        if (cache.size > 100) {
          cache.delete(cache.keys().next().value ?? "");
        }
      }
    };
    const readAsm = async () => {
      try {
        const data = await networkRequest(
          `/api/search/spotlight?${new URLSearchParams({ kind, limit: "8", q: trimmed })}`,
          { signal: controller.signal }
        );
        patch({ asm: parseSpotlightResponse(data), asmLoading: false });
      } catch (error) {
        patch({
          asmError:
            error instanceof Error
              ? error.message
              : "ASM search is unavailable",
          asmLoading: false,
        });
      }
    };
    const readRemote = async () => {
      try {
        const parsed = remoteSchema.parse(
          await networkRequest(
            `/api/protocols/bluesky/search?${new URLSearchParams({ kind, q: trimmed })}`,
            { signal: controller.signal }
          )
        );
        patch({
          bluesky: parsed,
          remoteError: parsed.unavailable.length
            ? `Some Bluesky ${parsed.unavailable.join(" and ")} are unavailable.`
            : null,
          remoteLoading: false,
        });
      } catch (error) {
        patch({
          remoteError:
            error instanceof Error
              ? error.message
              : "Bluesky search is unavailable",
          remoteLoading: false,
        });
      }
    };
    const timer = setTimeout(() => {
      if (asm) {
        void readAsm();
      }
      if (remote) {
        void readRemote();
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, open, network.ready, attempt, source, trimmed, kind, empty]);
  const current =
    state.key === key
      ? state
      : {
          ...empty,
          asmLoading: open && trimmed.length >= 2 && source !== "bluesky",
          remoteLoading:
            open &&
            trimmed.length >= 2 &&
            source !== "asm" &&
            kind !== "community",
        };
  const { preferences } = network.settings;
  const asm = {
    ...current.asm,
    posts: current.asm.posts.filter(
      (post) =>
        network.ready &&
        networkPostAllowed(post, preferences, network.settings.topicScope)
    ),
  };
  const bluesky = {
    ...current.bluesky,
    posts: current.bluesky.posts.filter(
      (post) =>
        network.ready &&
        externalNetworkPostAllowed(
          post,
          preferences,
          network.settings.topicScope
        )
    ),
    profiles: current.bluesky.profiles.filter(
      (author) =>
        network.ready &&
        (preferences.showExplicitContent || !blueskyMediaIsExplicit({ author }))
    ),
  };
  return {
    ...current,
    asm,
    bluesky,
    network,
    retry: () => setAttempt((value) => value + 1),
  };
}
