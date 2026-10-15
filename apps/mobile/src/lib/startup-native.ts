import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { hydrateMediaDimensions } from "@/features/feed/lib/media-dimensions";
import { hydrateFeedCache } from "@/features/feed/state/feed-store";
import { hydrateHomeTabMemory } from "@/features/feed/state/tab-store-native";
import { hydratePopupCache } from "@/features/home/components/profile-cache";
import { hydratePostDetailCache } from "@/features/post/lib/post-cache";
import { hydrateThemePreference } from "@/theme/theme-preference-native";

import { loadLaunchResumeRoute } from "./app-resume";
import { prepareStartup } from "./startup";

// Hydrate the existing Better Auth cache before mounting account-scoped
// screens. Its request hook otherwise restores this only after mount.
async function hydrateSession(): Promise<void> {
  if (Platform.OS === "web") {
    return;
  }
  const atom = authClient.$store.atoms.session;
  const initial = atom.get();
  if (initial.data) {
    return;
  }
  const raw = await SecureStore.getItemAsync("asocialmedia_session_data");
  if (!raw) {
    return;
  }
  const cached = JSON.parse(raw) as NonNullable<typeof initial.data> | null;
  if (
    cached?.user?.id &&
    cached.session?.id &&
    new Date(cached.session.expiresAt).getTime() > Date.now() &&
    atom.get() === initial
  ) {
    atom.set({ ...initial, data: cached, error: null, isPending: false });
  }
}

let preparation: Promise<string | null> | undefined;
export function prepareNativeStartup(): Promise<string | null> {
  preparation ??= (async () => {
    let resumePath: string | null = null;
    await prepareStartup([
      hydrateThemePreference,
      hydrateSession,
      hydrateFeedCache,
      hydrateMediaDimensions,
      hydrateHomeTabMemory,
      hydratePopupCache,
      hydratePostDetailCache,
      async () => {
        const resume = await loadLaunchResumeRoute();
        resumePath = resume?.pathname ?? "/";
      },
    ]);
    return resumePath;
  })();
  return preparation;
}
