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

export function useNetworkSettings() {
  const { user } = useSession();
  const client = useQueryClient();
  const queryKey = ["network-settings", user?.id ?? "guest"];
  const query = useQuery({
    enabled: Boolean(user),
    queryFn: readSettings,
    queryKey,
    staleTime: 30_000,
  });
  const settings = user ? (query.data ?? GUEST) : GUEST;
  const mutation = useMutation({
    mutationFn: async ({
      preferences,
      revision,
    }: {
      preferences: NetworkPreferences;
      revision: number;
    }): Promise<NetworkSettings> => {
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
    onError: (_error, _variables, previous) => {
      if (previous) {
        client.setQueryData(queryKey, previous);
      }
    },
    onMutate: async ({ preferences, revision }) => {
      await client.cancelQueries({ queryKey });
      const previous = client.getQueryData<NetworkSettings>(queryKey);
      client.setQueryData(queryKey, {
        ...settings,
        preferences,
        revision: revision + 1,
      });
      return previous;
    },
    onSuccess: (value) => {
      client.setQueryData(queryKey, value);
      window.dispatchEvent(new Event("network:settings-changed"));
      const channel =
        typeof BroadcastChannel === "undefined"
          ? null
          : new BroadcastChannel("asm-network-settings");
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no targetOrigin argument.
      channel?.postMessage("changed");
      channel?.close();
    },
  });
  const pending = useIsMutating({ mutationKey: queryKey });
  return {
    ...query,
    error: mutation.error ?? query.error,
    isSaving: pending > 0,
    ready: !user || Boolean(query.data),
    save: (preferences: NetworkPreferences) =>
      mutation.mutate({ preferences, revision: settings.revision }),
    scope: networkPreferenceScope(settings),
    settings,
  };
}
