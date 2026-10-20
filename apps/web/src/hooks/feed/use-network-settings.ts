"use client";

import {
  defaultNetworkPreferences,
  networkPreferenceScope,
} from "@asm/protocols/discovery";
import type {
  NetworkPreferences,
  NetworkSettings,
} from "@asm/protocols/discovery";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useSession } from "@/lib/auth/session-context";

const GUEST: NetworkSettings = {
  catalog: [],
  persona: {
    avoidedTopics: [],
    learnedInterests: [],
    relatedInterests: [],
    signalCount: 0,
  },
  preferences: defaultNetworkPreferences(),
  revision: 0,
};

async function readSettings(): Promise<NetworkSettings> {
  const response = await fetch("/api/network/preferences", {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Couldn't load network preferences");
  }
  return response.json();
}

export function useNetworkSettings(options: { optimistic?: boolean } = {}) {
  const { user } = useSession();
  const client = useQueryClient();
  const queryKey = ["network-settings", user?.id ?? "guest"];
  const query = useQuery({
    enabled: Boolean(user),
    queryFn: readSettings,
    queryKey,
    staleTime: 30_000,
  });
  const confirmed = user ? (query.data ?? GUEST) : GUEST;
  const sequence = useRef(0);
  const epoch = useRef(0);
  const [draft, setDraft] = useState<{
    viewer: string;
    preferences: NetworkPreferences;
    sequence: number;
  } | null>(null);
  const settings =
    options.optimistic && draft && draft.viewer === user?.id
      ? { ...confirmed, preferences: draft.preferences }
      : confirmed;
  const mutation = useMutation({
    mutationFn: async ({
      preferences,
      epoch: requestEpoch,
    }: {
      preferences: NetworkPreferences;
      epoch: number;
      sequence: number;
    }): Promise<NetworkSettings> => {
      if (requestEpoch !== epoch.current) {
        throw new Error("The previous change failed. Please try again.");
      }
      const revision =
        client.getQueryData<NetworkSettings>(queryKey)?.revision ??
        confirmed.revision;
      const response = await fetch("/api/network/preferences", {
        body: JSON.stringify({ preferences, revision }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      if (!response.ok) {
        const problem = await response.json();
        throw new Error(problem.error ?? "Couldn't save network preferences");
      }
      return response.json();
    },
    mutationKey: queryKey,
    onError: async (_error, variables) => {
      if (variables.epoch === epoch.current) {
        epoch.current += 1;
        setDraft(null);
        await client.invalidateQueries({ queryKey });
      }
    },
    onMutate: async () => {
      await client.cancelQueries({ queryKey });
    },
    onSuccess: (value, variables) => {
      client.setQueryData(queryKey, value);
      setDraft((current) =>
        current?.sequence === variables.sequence ? null : current
      );
      window.dispatchEvent(new Event("network:settings-changed"));
      const channel =
        typeof BroadcastChannel === "undefined"
          ? null
          : new BroadcastChannel("asm-network-settings");
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no targetOrigin argument.
      channel?.postMessage("changed");
      channel?.close();
    },
    scope: { id: `network-settings:${user?.id ?? "guest"}` },
  });
  const pending = useIsMutating({ mutationKey: queryKey });
  return {
    ...query,
    error: mutation.error ?? query.error,
    isSaving: pending > 0,
    ready: !user || Boolean(query.data),
    save: (preferences: NetworkPreferences) => {
      sequence.current += 1;
      const nextSequence = sequence.current;
      setDraft({
        preferences,
        sequence: nextSequence,
        viewer: user?.id ?? "guest",
      });
      mutation.mutate({
        epoch: epoch.current,
        preferences,
        sequence: nextSequence,
      });
    },
    scope: networkPreferenceScope(confirmed),
    settings,
  };
}
