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

export function useNetworkSettings() {
  const { user } = useSessionContext();
  const viewer = user?.id ?? "guest";
  const entry = useNetworkStore(
    (state) => state.entries[viewer] ?? EMPTY_ENTRY
  );
  const generation = useNetworkStore((state) => state.generation);
  useEffect(() => {
    void refreshNetworkSettings(viewer);
  }, [viewer]);
  const settings = user
    ? (entry.settings ?? GUEST_NETWORK_SETTINGS)
    : GUEST_NETWORK_SETTINGS;
  const mutate = async (preferences?: NetworkPreferences) => {
    const store = useNetworkStore.getState();
    const current = store.entries[viewer];
    if (!user || !current?.settings || current.saving) {
      return false;
    }
    const confirmed = current.settings;
    const parsed = preferences
      ? networkPreferencesSchema.safeParse(preferences)
      : null;
    if (parsed && !parsed.success) {
      store.patch(viewer, {
        error: parsed.error.issues[0]?.message ?? "Invalid preferences",
      });
      return false;
    }
    store.patch(viewer, { error: undefined, saving: true });
    try {
      const cookie = await authClient.getCookie();
      const next = networkSettingsSchema.parse(
        await networkRequest(
          "/api/network/preferences",
          {
            body: JSON.stringify(
              parsed?.success
                ? { preferences: parsed.data, revision: confirmed.revision }
                : {
                    profileId: confirmed.preferences.activeProfileId,
                    revision: confirmed.revision,
                  }
            ),
            method: preferences ? "PUT" : "DELETE",
          },
          cookie
        )
      );
      store.patch(viewer, { settings: next, updatedAt: Date.now() });
      store.changed();
      store.patch(viewer, { saving: false });
      return true;
    } catch (error) {
      if (error instanceof NetworkRequestError && error.status === 409) {
        await refreshNetworkSettings(viewer, true);
      }
      store.patch(viewer, {
        error:
          error instanceof Error
            ? error.message
            : "Couldn't save Network settings",
      });
      store.patch(viewer, { saving: false });
      return false;
    }
  };
  const scope = `${networkPreferenceScope(settings)}:${generation}`;
  const locale = discoveryLocale(settings.preferences);
  const profile = settings.preferences.activeProfileId;
  const request = useMemo(
    () => ({ locale, profile, scope }),
    [locale, profile, scope]
  );
  return {
    clearActivity: () => mutate(),
    error: entry.error,
    isFetching: entry.loading,
    isSaving: entry.saving,
    locale: discoveryLocale(settings.preferences),
    ready: !user || Boolean(entry.settings),
    refetch: () => refreshNetworkSettings(viewer, true),
    request,
    save: (preferences: NetworkPreferences) => mutate(preferences),
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
