import {
  defaultNetworkPreferences,
  networkPreferenceScope,
  networkPreferencesSchema,
} from "@asm/protocols/discovery";
import type {
  NetworkPreferences,
  NetworkSettings,
} from "@asm/protocols/discovery";
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { create } from "zustand";

import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";

import { discoveryLocale } from "../lib/discovery-locale";
import {
  NetworkRequestError,
  networkRequest,
  networkSettingsSchema,
} from "../lib/network-api";
import {
  setNetworkLearningViewer,
  flushNetworkObservations,
} from "../lib/network-learning";

export const GUEST_NETWORK_SETTINGS: NetworkSettings = {
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
interface NetworkEntry {
  settings?: NetworkSettings;
  // The latest unconfirmed preferences, shown by optimistic readers (the
  // settings screen) while the queued save is in flight, like web's draft.
  draft?: NetworkPreferences;
  error?: string;
  loading: boolean;
  saving: boolean;
  updatedAt: number;
}
const EMPTY_ENTRY: NetworkEntry = {
  loading: false,
  saving: false,
  updatedAt: 0,
};
export const useNetworkStore = create<{
  entries: Record<string, NetworkEntry>;
  generation: number;
  patch: (viewer: string, patch: Partial<NetworkEntry>) => void;
  changed: () => void;
}>((set) => ({
  changed: () => set((state) => ({ generation: state.generation + 1 })),
  entries: {},
  generation: 0,
  patch: (viewer, patch) =>
    set((state) => ({
      entries: {
        ...state.entries,
        [viewer]: { ...(state.entries[viewer] ?? EMPTY_ENTRY), ...patch },
      },
    })),
}));
const reads = new Map<string, Promise<void>>();
export function refreshNetworkSettings(
  viewer: string,
  force = false
): Promise<void> {
  if (viewer === "guest") {
    return Promise.resolve();
  }
  const pending = reads.get(viewer);
  if (pending) {
    return pending;
  }
  const store = useNetworkStore.getState();
  const previous = store.entries[viewer];
  if (
    !force &&
    previous?.settings &&
    Date.now() - previous.updatedAt < 30_000
  ) {
    return Promise.resolve();
  }
  store.patch(viewer, { loading: true });
  const request = (async () => {
    try {
      const cookie = await authClient.getCookie();
      const settings = networkSettingsSchema.parse(
        await networkRequest("/api/network/preferences", {}, cookie)
      );
      store.patch(viewer, {
        error: undefined,
        settings,
        updatedAt: Date.now(),
      });
    } catch (error) {
      store.patch(viewer, {
        error:
          error instanceof Error
            ? error.message
            : "Couldn't load Network settings",
      });
    } finally {
      store.patch(viewer, { loading: false });
      reads.delete(viewer);
    }
  })();
  reads.set(viewer, request);
  return request;
}

// Saves for one viewer run strictly in order, so rapid toggles queue instead of
// being dropped (web serializes them through a mutation scope). Each queued
// save reads the newest confirmed revision when it runs. A failure bumps the
// viewer's epoch, and saves queued before the failure are discarded, because
// they were built on preferences that never landed.
const saveQueues = new Map<string, Promise<unknown>>();
const saveSequence = new Map<string, number>();
const saveEpoch = new Map<string, number>();
const pendingSaves = new Map<string, number>();

function adjustPending(viewer: string, delta: number) {
  const next = Math.max(0, (pendingSaves.get(viewer) ?? 0) + delta);
  pendingSaves.set(viewer, next);
  useNetworkStore.getState().patch(viewer, { saving: next > 0 });
}

function enqueue<Result>(
  viewer: string,
  job: () => Promise<Result>
): Promise<Result> {
  const previous = saveQueues.get(viewer) ?? Promise.resolve();
  const run = (async () => {
    await previous;
    return job();
  })();
  saveQueues.set(
    viewer,
    (async () => {
      try {
        await run;
      } catch {
        // The queue only orders jobs; each job reports its own failure.
      }
    })()
  );
  return run;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function savePreferences(
  viewer: string,
  preferences: NetworkPreferences
): Promise<boolean> {
  const store = useNetworkStore.getState();
  if (!store.entries[viewer]?.settings) {
    return Promise.resolve(false);
  }
  const parsed = networkPreferencesSchema.safeParse(preferences);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid preferences";
    store.patch(viewer, { error: message });
    toast({
      description: message,
      title: "Couldn't save Network settings",
      variant: "destructive",
    });
    return Promise.resolve(false);
  }
  const sequence = (saveSequence.get(viewer) ?? 0) + 1;
  saveSequence.set(viewer, sequence);
  const epoch = saveEpoch.get(viewer) ?? 0;
  store.patch(viewer, { draft: parsed.data, error: undefined });
  adjustPending(viewer, 1);
  return enqueue(viewer, async () => {
    const current = useNetworkStore.getState();
    const confirmed = current.entries[viewer]?.settings;
    try {
      if ((saveEpoch.get(viewer) ?? 0) !== epoch || !confirmed) {
        return false;
      }
      const cookie = await authClient.getCookie();
      const next = networkSettingsSchema.parse(
        await networkRequest(
          "/api/network/preferences",
          {
            body: JSON.stringify({
              preferences: parsed.data,
              revision: confirmed.revision,
            }),
            method: "PUT",
          },
          cookie
        )
      );
      const latest = saveSequence.get(viewer) === sequence;
      current.patch(viewer, {
        ...(latest ? { draft: undefined } : {}),
        settings: next,
        updatedAt: Date.now(),
      });
      current.changed();
      if (latest) {
        toast({
          description: "Your feeds will use these preferences.",
          title: "Network settings saved",
        });
      }
      return true;
    } catch (error) {
      saveEpoch.set(viewer, epoch + 1);
      const message = errorMessage(error, "Couldn't save network preferences");
      current.patch(viewer, { draft: undefined, error: message });
      toast({
        description: message,
        title: "Couldn't save Network settings",
        variant: "destructive",
      });
      await refreshNetworkSettings(viewer, true);
      return false;
    } finally {
      adjustPending(viewer, -1);
    }
  });
}

function clearRecentActivity(viewer: string): Promise<boolean> {
  if (!useNetworkStore.getState().entries[viewer]?.settings) {
    return Promise.resolve(false);
  }
  adjustPending(viewer, 1);
  return enqueue(viewer, async () => {
    const current = useNetworkStore.getState();
    const confirmed = current.entries[viewer]?.settings;
    try {
      if (!confirmed) {
        return false;
      }
      const cookie = await authClient.getCookie();
      const next = networkSettingsSchema.parse(
        await networkRequest(
          "/api/network/preferences",
          {
            body: JSON.stringify({
              profileId: confirmed.preferences.activeProfileId,
              revision: confirmed.revision,
            }),
            method: "DELETE",
          },
          cookie
        )
      );
      current.patch(viewer, { settings: next, updatedAt: Date.now() });
      current.changed();
      toast({
        description: "This profile can start learning again.",
        title: "Recent activity cleared",
      });
      return true;
    } catch (error) {
      const message =
        error instanceof NetworkRequestError && error.status === 409
          ? "Settings changed. Refresh and try again."
          : "Couldn't clear recent activity. Please try again.";
      toast({ title: message, variant: "destructive" });
      if (error instanceof NetworkRequestError && error.status === 409) {
        await refreshNetworkSettings(viewer, true);
      }
      return false;
    } finally {
      adjustPending(viewer, -1);
    }
  });
}

// `optimistic` mirrors web's `useNetworkSettings({ optimistic: true })`: the
// settings screen shows a queued change at once, while feeds keep reading the
// confirmed preferences so they do not refetch on every tap.
export function useNetworkSettings({
  optimistic = false,
}: { optimistic?: boolean } = {}) {
  const { user } = useSessionContext();
  const viewer = user?.id ?? "guest";
  const entry = useNetworkStore(
    (state) => state.entries[viewer] ?? EMPTY_ENTRY
  );
  const generation = useNetworkStore((state) => state.generation);
  useEffect(() => {
    void refreshNetworkSettings(viewer);
  }, [viewer]);
  const confirmed = user
    ? (entry.settings ?? GUEST_NETWORK_SETTINGS)
    : GUEST_NETWORK_SETTINGS;
  const settings =
    optimistic && user && entry.draft
      ? { ...confirmed, preferences: entry.draft }
      : confirmed;
  const scope = `${networkPreferenceScope(confirmed)}:${generation}`;
  const locale = discoveryLocale(confirmed.preferences);
  const profile = confirmed.preferences.activeProfileId;
  const request = useMemo(
    () => ({ locale, profile, scope }),
    [locale, profile, scope]
  );
  return {
    clearActivity: () =>
      user ? clearRecentActivity(viewer) : Promise.resolve(false),
    error: entry.error,
    isFetching: entry.loading,
    isSaving: entry.saving,
    locale,
    ready: !user || Boolean(entry.settings),
    refetch: () => refreshNetworkSettings(viewer, true),
    request,
    save: (preferences: NetworkPreferences) =>
      user ? savePreferences(viewer, preferences) : Promise.resolve(false),
    scope,
    settings,
    viewer,
  };
}

export function NetworkSettingsSync() {
  const { viewer } = useNetworkSettings();
  useEffect(() => {
    setNetworkLearningViewer(viewer);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshNetworkSettings(viewer, true);
      } else {
        void flushNetworkObservations();
      }
    });
    return () => subscription.remove();
  }, [viewer]);
  return null;
}
